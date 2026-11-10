/**
 * discountService.js
 * ─────────────────────────────────────────────────────────────────
 * CRUD de DiscountRule + endpoint de preview.
 *
 * SEGURIDAD:
 *  - El `layer` siempre se deriva del `type` server-side (AXIOMA 1).
 *  - El `createdBy` viene del usuario autenticado, nunca del body.
 *  - El `usedUnits` es de solo lectura para el cliente.
 * ─────────────────────────────────────────────────────────────────
 */

const prisma = require('../db/database.prisma.js');
const { DEFAULT_PRIORITIES } = require('./discountEngine');
const { runUniversalPipeline } = require('./discountEngine/universal');
const { validateConditionsDual } = require('./discountEngine/validators');
const { money, round, toNumber, sum } = require('../utils/money');

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

/**
 * Valida si el porcentaje de una regla supera el tope de la tienda.
 * Lanza un Error si se excede el tope configurado (AXIOM-SECURITY).
 */
async function validatePercentageAgainstCap(storeId, percentage) {
  const storeConfig = await prisma.store.findUnique({
    where: { id: storeId },
    select: { maxDiscountPct: true },
  });
  const storeMax = storeConfig?.maxDiscountPct ?? 50;

  if (percentage > storeMax) {
    throw new Error(`Seguridad: No se puede crear un descuento (${percentage}%) que supere el tope de la tienda (${storeMax}%).`);
  }
}

// ─────────────────────────────────────────────────────────────────
// Engine Routing Helpers (Fase 2 — Dual Engine)
// ─────────────────────────────────────────────────────────────────

/**
 * Separa reglas activas en dos listas según su engineVersion.
 *
 * NOTA (motor legacy retirado): el único motor de descuentos que existe
 * hoy es el universal (`runUniversalPipeline`) — no hay implementación
 * legacy en este código base. `engineVersion` se fuerza a 'universal'
 * server-side para toda regla creada o editada (ver `sanitizeRuleInput`),
 * y una migración de datos normaliza las filas existentes con
 * 'legacy'/null. En runtime estable `legacyRules` debería estar siempre
 * vacío; esta función se mantiene como separación defensiva para que
 * cualquier fila que aún no haya pasado por esa normalización no se
 * ejecute por error contra el motor universal (ver call sites en
 * `preview()` y `salesServices.js`, que ignoran `legacyRules` en vez de
 * pasarlas a ningún pipeline).
 *
 * @param {Object[]} rules — reglas activas de la tienda
 * @returns {{ legacyRules: Object[], universalRules: Object[] }}
 */
function splitRulesByEngine(rules) {
  const legacyRules = [];
  const universalRules = [];

  for (const rule of rules) {
    if (rule.engineVersion === 'universal') {
      universalRules.push(rule);
    } else {
      // null, undefined, 'legacy' → no normalizada aún; ver nota arriba
      legacyRules.push(rule);
    }
  }

  return { legacyRules, universalRules };
}

/**
 * Procesa el resultado del motor universal en una respuesta unificada.
 * Contrato backward-compatible: los campos top-level no cambian de nombre/tipo.
 * (Históricamente combinaba legacy + universal; el motor legacy fue retirado
 * — no existía ninguna implementación real detrás de él — así que esta
 * función ahora solo post-procesa el resultado universal: cap de tienda,
 * blindaje nominal, recalculación de montos, etc.)
 *
 * @param {Object} universalResult — resultado de runUniversalPipeline (puede ser vacío)
 * @param {number} originalTotal — subtotal calculado desde los items del carrito
 * @param {Object[]} [allRules] — reglas originales para obtener nombres (opcional)
 * @returns {Object} respuesta unificada
 */
function mergeEngineResults(universalResult, originalTotal, allRules = [], maxDiscountPct = 80, preferredRuleIds = [], excludedRuleIds = []) {
  // ── Aplicar tope de descuento de la tienda ──────────────────────
  const maxAllowedDiscount = toNumber(money(originalTotal).times(maxDiscountPct).dividedBy(100));

  // Crear mapa de reglas para buscar nombres
  const ruleMap = new Map(allRules.map(r => [r.id, r]));

  // Función para enriquecer aplica descuentos con nombre de regla
  const enrichDiscount = (d) => {
    const rule = ruleMap.get(d.ruleId);
    return {
      ...d,
      name: rule?.name ?? d.name ?? d.reason ?? `Descuento ${d.ruleId?.substring(0, 8)}`,
      percentage: rule?.percentage ?? d.percentage ?? null,
      allowPartial: rule?.allowPartial ?? d.allowPartial ?? false, // NUEVO
      _matchingAmount: d._matchingAmount ?? rule?._matchingAmount, // NUEVO
      priority: rule?.priority ?? 0,
      type: d.productId || d.type === 'ITEM' ? 'ITEM' : (rule?.type ?? 'ORDER'),
      engine: d.engine ?? 'universal',
    };
  };

  // Etiquetar cada applied discount con su motor de origen y nombre
  const combinedApplied = (universalResult?.appliedDiscounts ?? []).map(enrichDiscount);

  // ── Blindaje Quirúrgico por Ignorado Estricto (Sin Recortes) ──
  // PRIORIDAD: Preferred (User) > ITEM > ORDER > Priority (DESC) > Name (ASC)
  const sortedApplied = [...combinedApplied].sort((a, b) => {
    const isPrefA = preferredRuleIds.includes(a.ruleId);
    const isPrefB = preferredRuleIds.includes(b.ruleId);

    // 1. Prioridad Manual (Preferencias del usuario)
    if (isPrefA && !isPrefB) return -1;
    if (!isPrefA && isPrefB) return 1;

    // 2. Prioridad Natural (ITEM > ORDER)
    const layerA = a.productId || a.type === 'ITEM' ? 0 : 1;
    const layerB = b.productId || b.type === 'ITEM' ? 0 : 1;
    if (layerA !== layerB) return layerA - layerB;

    // 3. Valor de Prioridad (DESC)
    const prioA = a.priority || 0;
    const prioB = b.priority || 0;
    if (prioA !== prioB) return prioB - prioA;

    // 4. Tie-breaker (Nombre Alfabético)
    return a.name.localeCompare(b.name);
  });

  let nominalSpaceUsed = 0; // Acumulación nominal para el blindaje (Axioma 12.3)
  let finalApplied = [];
  let interchangeableDiscounts = [];

  for (const d of sortedApplied) {
    // ── Axioma del Impacto Atómico ──
    // El impacto nominal (espacio que ocupa en el cupo) debe ser INMUNE a la cascada.
    // Si la regla tiene porcentaje, se calcula SIEMPRE sobre el total original.
    // Si la regla es de monto fijo, se usa el monto absoluto.
    const hasPct = d.percentage !== null && d.percentage !== undefined;

    // Impacto Nominal: Si es parcial, se calcula sobre el monto que coincide, no sobre el total.
    const baseForNominal = (d.allowPartial && d._matchingAmount !== undefined)
      ? Math.min(d._matchingAmount, originalTotal)
      : originalTotal;

    const nominalImpact = hasPct
      ? toNumber(money(baseForNominal).times(d.percentage).dividedBy(100))
      : (d.amount || 0);

    const isExcluded = excludedRuleIds.includes(d.ruleId);
    const projectedNominal = toNumber(money(nominalSpaceUsed).plus(nominalImpact));

    if (!isExcluded && projectedNominal <= maxAllowedDiscount + 0.01) {
      // CABE NOMINALMENTE Y NO ESTA EXCLUIDA: Se pre-selecciona
      finalApplied.push({ ...d, nominalImpact });
      nominalSpaceUsed = projectedNominal;
    } else {
      // NO CABE O ESTA EXCLUIDA: SE IGNORA (Va a intercambiables)
      interchangeableDiscounts.push({ ...d, nominalImpact });
    }
  }

  // ── 3. Fase de Recalculación (Limpieza de "Fantasmas") ──
  // Re-calculamos los montos reales sobre el subtotal que va quedando limpio
  let recalculatedApplied = [];
  let currentSubtotal = originalTotal;
  let totalRecalculatedDiscount = 0;

  for (const rule of finalApplied) {
    let finalAmount = 0;
    const isItem = rule.productId || rule.type === 'ITEM';

    if (isItem) {
      // Regla de ITEM: Mantenemos el monto calculado por el motor (es específico al producto)
      finalAmount = rule.amount;
    } else {
      // Regla de ORDER: Recalculamos sobre el subtotal ACTUAL o sobre el _matchingAmount si es parcial
      const baseAmount = (rule.allowPartial && rule._matchingAmount !== undefined)
        ? Math.min(rule._matchingAmount, currentSubtotal)
        : currentSubtotal;
      finalAmount = toNumber(money(baseAmount).times(rule.percentage ?? 0).dividedBy(100));
    }

    const updatedRule = { ...rule, amount: finalAmount };
    recalculatedApplied.push(updatedRule);

    currentSubtotal = toNumber(money(currentSubtotal).minus(finalAmount));
    totalRecalculatedDiscount = toNumber(money(totalRecalculatedDiscount).plus(finalAmount));
  }

  // Actualizamos para el retorno
  // (declaración agregada como efecto trivial de tocar esta línea para Decimal-safety;
  // la variable era global implícita en el código original — fuera de alcance como
  // limpieza independiente, ver propuesta "hallazgos menores")
  let runningDiscount = totalRecalculatedDiscount;
  finalApplied = recalculatedApplied;

  // Mensaje de blindaje
  let capApplied = interchangeableDiscounts.length > 0;

  // Sincronizar el total real final
  const discountTotal = runningDiscount;
  const finalTotal = Math.max(toNumber(money(originalTotal).minus(discountTotal)), 0.01);

  // Sincronizar array de items (PARA EL POS — SC-2.4)
  // Cada item debe reflejar solo si su regla "sobrevivió" a la poda.
  // Si una regla de ITEM fue descartada por el blindaje, el item vuelve a su precio original.
  const survivorRuleIds = new Set(finalApplied.map(f => f.ruleId));
  const survivorItems = (universalResult?.items ?? []).map(item => {
    // Verificamos si la regla que el motor le aplicó a este item sobrevivió al blindaje nominal
    const isSurvivor = item.appliedRule && survivorRuleIds.has(item.appliedRule.ruleId);
    const finalItemDiscount = isSurvivor ? item.discountAmount : 0;

    return {
      ...item,
      discountAmount: finalItemDiscount,
      finalPrice: toNumber(money(item.originalSubtotal).minus(finalItemDiscount)),
    };
  });

  const warnings = [...(universalResult?.warnings ?? [])];

  return {
    originalTotal,
    discountTotal: runningDiscount,
    finalTotal: toNumber(money(originalTotal).minus(runningDiscount)),
    appliedDiscounts: finalApplied,
    interchangeableDiscounts,
    capApplied,
    maxDiscountPct,
    maxDiscountAmount: maxAllowedDiscount,
    items: survivorItems,
    conditionalDiscounts: [...(universalResult?.conditionalDiscounts ?? [])],
    warnings,
  };
}

/**
 * Extrae solo los campos permitidos del body para crear/editar una regla.
 * Nunca acepta `layer`, `usedUnits`, `createdBy` del cliente.
 *
 * SEGURIDAD: `engineVersion` se fuerza SIEMPRE a 'universal' server-side,
 * sin importar lo que envíe el cliente (mismo principio de "no confiar en
 * el cliente para nada que afecte la plata" ya aplicado a `layer`). No
 * existe ningún motor legacy real en este código base — aceptar cualquier
 * otro valor acá terminaba creando reglas que `runUniversalPipeline`
 * filtra y nunca ejecuta (descuento $0 silencioso). `type`/`conditions`
 * se mantienen en el modelo solo por compatibilidad histórica de datos.
 */
function sanitizeRuleInput(body) {
  const {
    name, description,
    type, percentage,
    startsAt, endsAt,
    conditions,
    conditionsUniversal,
    priority,
    isCombinable,
    allowPartial,
    combinesWith,
    maxPercentage,
  } = body;
  return {
    name, description,
    type: type ?? null,
    percentage,
    startsAt: startsAt ? new Date(startsAt) : null,
    endsAt: endsAt ? new Date(endsAt) : null,
    conditions: conditions ?? null,
    conditionsUniversal: conditionsUniversal ?? null,
    engineVersion: 'universal', // forzado server-side — ver nota arriba
    priority: priority ?? DEFAULT_PRIORITIES[type] ?? 0,
    isCombinable: isCombinable ?? true,
    allowPartial: allowPartial ?? false,
    combinesWith: combinesWith ?? [],
    maxPercentage: maxPercentage ?? null,
  };
}

/**
 * Valida un body de regla y lanza si hay errores.
 *
 * Toda regla se valida y persiste como universal (ver `sanitizeRuleInput`,
 * que fuerza `engineVersion: 'universal'` server-side sin importar lo que
 * mande el cliente). Por eso esta validación ignora cualquier
 * `engineVersion` del body y exige siempre `conditionsUniversal` — si en
 * cambio ramificara según el `engineVersion` que mandó el cliente,
 * aceptaría payloads con forma legacy (`type` + `conditions`, sin
 * `conditionsUniversal`) que luego se guardan como 'universal' sin
 * condiciones reales, resultando en una regla que el motor jamás ejecuta.
 *
 * @throws {Error}
 */
function validateRuleBody({ percentage, conditionsUniversal }) {
  if (typeof percentage !== 'number' || percentage <= 0 || percentage >= 100) {
    throw new Error('`percentage` debe ser un número entre 0.01 y 99.99.');
  }

  if (!conditionsUniversal || typeof conditionsUniversal !== 'object') {
    throw new Error('`conditionsUniversal` debe ser un objeto para reglas universales.');
  }
  const condError = validateConditionsDual(conditionsUniversal, 'universal');
  if (condError) throw new Error(`conditionsUniversal inválidas: ${condError}`);
}

// ─────────────────────────────────────────────────────────────────
// CRUD
// ─────────────────────────────────────────────────────────────────

/**
 * Lista todas las reglas de la tienda (activas + inactivas).
 */
const getAll = async (storeId) => {
  if (!storeId) throw new Error('El usuario no tiene tienda asignada.');

  return prisma.discountRule.findMany({
    where: { storeId },
    orderBy: [{ isActive: 'desc' }, { priority: 'desc' }, { createdAt: 'desc' }],
    include: { creator: { select: { id: true, fullName: true, email: true } } },
  });
};

/**
 * Obtiene una regla por ID, validando que pertenece a la tienda.
 */
const getById = async (id, storeId) => {
  if (!storeId) throw new Error('El usuario no tiene tienda asignada.');

  const rule = await prisma.discountRule.findFirst({
    where: { id, storeId },
    include: { creator: { select: { id: true, fullName: true, email: true } } },
  });
  if (!rule) throw new Error(`Regla de descuento '${id}' no encontrada.`);
  return rule;
};

/**
 * Crea una nueva regla de descuento.
 * El `layer` se deriva del `type` (AXIOMA 1), nunca del body.
 */
const create = async (body, user) => {
  const storeId = user.storeId;
  if (!storeId) throw new Error('El usuario no tiene tienda asignada.');

  validateRuleBody(body);

  // Validar seguridad (tope de tienda)
  await validatePercentageAgainstCap(storeId, body.percentage);

  const input = sanitizeRuleInput(body);

  // AXIOM-4: layer derivado del tipo de regla, nunca del request
  // Se infiere siempre del target universal (con target → ITEM, sin target → ORDER)
  const target = input.conditionsUniversal?.target;
  const hasTarget = target && (target.productIds?.length > 0 || target.categoryIds?.length > 0);
  const layer = hasTarget ? 'ITEM' : 'ORDER';

  const rule = await prisma.discountRule.create({
    data: {
      store: { connect: { id: storeId } },
      creator: { connect: { id: user.id } },
      layer,
      ...input,
    },
    include: { creator: { select: { id: true, fullName: true } } },
  });

  return rule;
};

/**
 * Actualiza una regla existente.
 * Si cambia el `type`, el `layer` se recalcula automáticamente.
 * `usedUnits` y `createdBy` no son modificables.
 */
const update = async (id, body, user) => {
  const storeId = user.storeId;
  await getById(id, storeId); // verifica ownership

  validateRuleBody(body);
  const input = sanitizeRuleInput(body);

  // Mismo mecanismo de derivación de layer que en create (AXIOM-4)
  const target = input.conditionsUniversal?.target;
  const hasTarget = target && (target.productIds?.length > 0 || target.categoryIds?.length > 0);
  const layer = hasTarget ? 'ITEM' : 'ORDER';

  // Validar seguridad (tope de tienda)
  await validatePercentageAgainstCap(storeId, body.percentage);

  const rule = await prisma.discountRule.update({
    where: { id },
    data: { layer, ...input },
    include: { creator: { select: { id: true, fullName: true } } },
  });

  return rule;
};

/**
 * Soft delete: desactiva una regla (isActive = false).
 * No elimina físicamente para preservar auditoría en AppliedDiscount.
 */
const deactivate = async (id, user) => {
  const storeId = user.storeId;
  if (!storeId) throw new Error('El usuario no tiene tienda asignada.');

  await getById(id, storeId); // verifica ownership

  return prisma.discountRule.update({
    where: { id },
    data: { isActive: false },
  });
};

/**
 * Hard delete: elimina físicamente la regla de la DB.
 * Primero elimina AppliedDiscount relacionados, luego DiscountRule.
 * Solo disponible para roles ADMINISTRADOR y SISTEMA.
 *
 * @param {string} id — ID de la regla
 * @param {object} user — usuario autenticado (debe tener storeId)
 * @returns {object} resultado de la eliminación
 */
const remove = async (id, user) => {
  const storeId = user.storeId;
  if (!storeId) throw new Error('El usuario no tiene tienda asignada.');

  // Verificar ownership antes de eliminar
  await getById(id, storeId);

  // Eliminar en transacción: primero AppliedDiscount, luego DiscountRule
  return prisma.$transaction(async (tx) => {
    // 1. Eliminar AppliedDiscount relacionados
    await tx.appliedDiscount.deleteMany({
      where: { discountRuleId: id },
    });

    // 2. Eliminar la DiscountRule
    await tx.discountRule.delete({
      where: { id },
    });

    return { id, deleted: true };
  });
};

/**
 * Reactiva una regla previamente desactivada.
 */
const activate = async (id, user) => {
  const storeId = user.storeId;
  if (!storeId) throw new Error('El usuario no tiene tienda asignada.');

  await getById(id, storeId);

  return prisma.discountRule.update({
    where: { id },
    data: { isActive: true },
  });
};

// ─────────────────────────────────────────────────────────────────
// Preview
// ─────────────────────────────────────────────────────────────────

/**
 * Calcula descuentos SIN persistir nada.
 * Usa exactamente el mismo motor que la venta real.
 *
 * @param {object} body — { items, clientId?, paymentBreakdown? }
 *   NOTA: `paymentMethods` NO se acepta como campo independiente del body —
 *   se deriva siempre de `paymentBreakdown` (ver nota de seguridad abajo).
 * @param {object} user — usuario autenticado
 */
const preview = async (storeId, body) => {
  const {
    items,
    clientId,
    paymentBreakdown,
    preferredRuleIds = [],
    excludedRuleIds = []
  } = body;

  // Normalización de Métodos de Pago (Consistencia con salesServices.js)
  if (Array.isArray(paymentBreakdown)) {
    paymentBreakdown.forEach(p => {
      if (p.method === "Cuenta Corriente") p.method = "CUENTA_CORRIENTE";
    });
  }

  // SEGURIDAD: `paymentMethods` se deriva SIEMPRE de `paymentBreakdown`, igual
  // que en salesServices.create() — nunca se acepta como campo independiente
  // del body. Antes, un cliente podía mandar `paymentMethods: ['CASH']` sin
  // breakdown y forzar la rama binaria de `validateTicketConditions` (que
  // asume el 100% del subtotal como coincidente), mostrando un descuento muy
  // superior al que la venta real terminaría aplicando si el pago real
  // resultaba dividido entre varios medios. Al derivar siempre del
  // breakdown, preview() y la venta real quedan atadas a la misma rama
  // proporcional bajo las mismas condiciones.
  const paymentMethods = (paymentBreakdown ?? []).map(p => p.method);

  if (!items || !Array.isArray(items)) throw new Error("Items son requeridos.");

  // Leer precios reales de DB (nunca del frontend)
  const productIds = items.map(i => i.id ?? i.productId);
  const dbProducts = await prisma.product.findMany({
    where: { id: { in: productIds }, storeId },
    select: { id: true, price: true, categoryId: true },
  });
  const productMap = new Map(dbProducts.map(p => [p.id, p]));

  const cartItems = items.map(item => {
    const pid = item.id ?? item.productId;
    const product = productMap.get(pid);
    if (!product) throw new Error(`Producto '${pid}' no encontrado en esta tienda.`);
    return {
      productId: pid,
      categoryId: product.categoryId ?? undefined,
      quantity: item.quantity,
      unitPrice: product.price,
    };
  });

  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { maxDiscountPct: true },
  });

  // Calcular originalTotal una sola vez desde los items reales (SC-2.3).
  // i.unitPrice = product.price (Prisma.Decimal real) — nunca operador nativo.
  const originalTotal = toNumber(sum(cartItems, (i) => money(i.unitPrice).times(i.quantity)));

  // ── Fase 2: Filtrado y Separación por Engine (SC-2.1) ─────────
  const allRulesRaw = await prisma.discountRule.findMany({
    where: { storeId, isActive: true },
  });

  // FILTRADO QUIRÚRGICO: Ignorar reglas que superen el tope máximo de la tienda (Axioma 12.2)
  const storeMax = store?.maxDiscountPct ?? 50;
  const allRules = allRulesRaw.filter(r => (r.percentage ?? 0) <= storeMax);

  const { legacyRules, universalRules } = splitRulesByEngine(allRules);

  // Blindaje: en runtime estable `legacyRules` debería estar siempre vacío
  // (ver nota en splitRulesByEngine — el motor legacy fue retirado, no hay
  // implementación real detrás de él). Si aparece alguna, es porque esa fila
  // todavía no pasó por la normalización de `engineVersion`; la ignoramos
  // explícitamente en vez de ejecutarla contra el motor universal (eso
  // producía un descuento $0 silencioso), pero lo señalamos para que no
  // sea invisible.
  if (legacyRules.length > 0) {
    console.warn(
      `[discountService.preview] ${legacyRules.length} regla(s) con engineVersion legacy/null ignoradas (motor legacy retirado). IDs: ${legacyRules.map(r => r.id).join(', ')}`
    );
  }

  // ── Ejecutar motor universal (SC-2.2) ─────────────────────────
  const universalContext = {
    storeId,
    clientId: clientId ?? null,
    paymentMethods, // derivado de paymentBreakdown — ver nota de seguridad arriba
    paymentBreakdown: paymentBreakdown ?? [],
    items: cartItems,
  };
  const universalResult = universalRules.length > 0
    ? runUniversalPipeline(universalContext, universalRules)
    : { discountTotal: 0, appliedDiscounts: [], conditionalDiscounts: [], warnings: [] };

  // ── Post-procesar resultado del motor universal (SC-2.3) ──────
  const result = mergeEngineResults(
    universalResult,
    originalTotal,
    allRules,
    store?.maxDiscountPct ?? 50,
    preferredRuleIds,
    excludedRuleIds // Pasamos las exclusiones al unificador
  );

  if (legacyRules.length > 0) {
    result.warnings = [
      ...(result.warnings ?? []),
      `${legacyRules.length} regla(s) de descuento con engineVersion legacy fueron ignoradas (motor legacy retirado; ejecutar backfill de datos).`,
    ];
  }

  return result;
};

module.exports = { getAll, getById, create, update, deactivate, remove, activate, preview, splitRulesByEngine, mergeEngineResults };
