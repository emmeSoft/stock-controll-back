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

const prisma              = require('../db/database.prisma.js');
const { validateConditions, getLayer, DEFAULT_PRIORITIES, runPipeline } = require('./discountEngine');
const { runUniversalPipeline } = require('./discountEngine/universal');
const { validateConditionsDual } = require('./discountEngine/validators');

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────
// Engine Routing Helpers (Fase 2 — Dual Engine)
// ─────────────────────────────────────────────────────────────────

/**
 * Separa reglas activas en dos listas según su engineVersion.
 * Las reglas sin engineVersion o con engineVersion=null caen como legacy
 * para garantizar backward-compatibility (AXIOM-3).
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
      // null, undefined, 'legacy' → motor legacy (backward-compatible)
      legacyRules.push(rule);
    }
  }

  return { legacyRules, universalRules };
}

/**
 * Combina los resultados de ambos motores en una respuesta unificada.
 * Contrato backward-compatible: los campos top-level no cambian de nombre/tipo.
 *
 * @param {Object} legacyResult  — resultado de runPipeline (puede ser vacío)
 * @param {Object} universalResult — resultado de runUniversalPipeline (puede ser vacío)
 * @param {number} originalTotal — subtotal calculado desde los items del carrito
 * @param {Object[]} [allRules] — reglas originales para obtener nombres (opcional)
 * @returns {Object} respuesta unificada
 */
function mergeEngineResults(legacyResult, universalResult, originalTotal, allRules = []) {
  const legacyDiscountTotal   = legacyResult?.discountTotal   ?? 0;
  const universalDiscountTotal = universalResult?.discountTotal ?? 0;
  const discountTotal = legacyDiscountTotal + universalDiscountTotal;
  const finalTotal = Math.max(originalTotal - discountTotal, 0.01);

  // Crear mapa de reglas para buscar nombres
  const ruleMap = new Map(allRules.map(r => [r.id, r]));

  // Función para enriquecer aplica descuentos con nombre de regla
  const enrichDiscount = (d) => {
    const rule = ruleMap.get(d.ruleId);
    return {
      ...d,
      name: rule?.name ?? d.name ?? d.reason ?? `Descuento ${d.ruleId?.substring(0, 8)}`,
      percentage: rule?.percentage ?? d.percentage ?? null,
      engine: d.engine ?? 'unknown',
    };
  };

  // Etiquetar cada applied discount con su motor de origen y nombre
  const legacyApplied = (legacyResult?.appliedDiscounts ?? []).map(enrichDiscount);
  const universalApplied = (universalResult?.appliedDiscounts ?? []).map(enrichDiscount);

  return {
    originalTotal:       parseFloat(originalTotal.toFixed(2)),
    discountTotal:       parseFloat(discountTotal.toFixed(2)),
    finalTotal:          parseFloat(finalTotal.toFixed(2)),
    appliedDiscounts:    [...legacyApplied, ...universalApplied],
    conditionalDiscounts: [
      ...(legacyResult?.conditionalDiscounts   ?? []),
      ...(universalResult?.conditionalDiscounts ?? []),
    ],
    warnings: [
      ...(legacyResult?.warnings   ?? []),
      ...(universalResult?.warnings ?? []),
    ],
  };
}

/**
 * Extrae solo los campos permitidos del body para crear/editar una regla.
 * Acepta tanto el formato legacy como el universal.
 * Nunca acepta `layer`, `usedUnits`, `createdBy` del cliente.
 */
function sanitizeRuleInput(body) {
  const {
    name, description,
    type, percentage,
    startsAt, endsAt,
    conditions,
    conditionsUniversal,
    engineVersion,
    priority,
    isCombinable,
    combinesWith,
    maxPercentage,
  } = body;
  return {
    name, description,
    type:        type ?? null,
    percentage,
    startsAt:    startsAt ? new Date(startsAt) : null,
    endsAt:      endsAt   ? new Date(endsAt)   : null,
    conditions:  conditions   ?? null,
    conditionsUniversal: conditionsUniversal ?? null,
    engineVersion: engineVersion ?? 'legacy',
    priority:       priority       ?? DEFAULT_PRIORITIES[type] ?? 0,
    isCombinable:   isCombinable   ?? true,
    combinesWith:   combinesWith   ?? [],
    maxPercentage:  maxPercentage  ?? null,
  };
}

/**
 * Valida un body de regla y lanza si hay errores.
 * Soporta tanto el formato legacy como el universal (SC-2.4).
 * @throws {Error}
 */
function validateRuleBody({ type, percentage, conditions, conditionsUniversal, engineVersion }) {
  if (typeof percentage !== 'number' || percentage <= 0 || percentage >= 100) {
    throw new Error('`percentage` debe ser un número entre 0.01 y 99.99.');
  }

  const version = engineVersion ?? 'legacy';

  if (version === 'universal') {
    // Reglas universales: conditionsUniversal requerido, type opcional
    if (!conditionsUniversal || typeof conditionsUniversal !== 'object') {
      throw new Error('`conditionsUniversal` debe ser un objeto para reglas universales.');
    }
    const condError = validateConditionsDual(conditionsUniversal, 'universal');
    if (condError) throw new Error(`conditionsUniversal inválidas: ${condError}`);
  } else {
    // Reglas legacy: type y conditions requeridos
    if (!type) throw new Error('El campo `type` es obligatorio para reglas legacy.');
    if (!conditions || typeof conditions !== 'object') {
      throw new Error('`conditions` debe ser un objeto para reglas legacy.');
    }
    const condError = validateConditionsDual(conditions, 'legacy', type);
    if (condError) throw new Error(`Conditions inválidas para tipo ${type}: ${condError}`);
  }
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
    where:   { storeId },
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
    where:   { id, storeId },
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

  const input = sanitizeRuleInput(body);

  // AXIOM-4: layer derivado del tipo de regla, nunca del request
  // Para universales: se infiere del target (con target → ITEM, sin target → ORDER)
  let layer;
  if (input.engineVersion === 'universal') {
    const target = input.conditionsUniversal?.target;
    const hasTarget = target && (target.productIds?.length > 0 || target.categoryIds?.length > 0);
    layer = hasTarget ? 'ITEM' : 'ORDER';
  } else {
    layer = getLayer(input.type); // legacy: del type
  }

  return prisma.discountRule.create({
    data: {
      store: { connect: { id: storeId } },
      creator: { connect: { id: user.id } },
      layer,
      ...input,
    },
    include: { creator: { select: { id: true, fullName: true } } },
  });
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
  let layer;
  if (input.engineVersion === 'universal') {
    const target = input.conditionsUniversal?.target;
    const hasTarget = target && (target.productIds?.length > 0 || target.categoryIds?.length > 0);
    layer = hasTarget ? 'ITEM' : 'ORDER';
  } else {
    layer = getLayer(input.type);
  }

  return prisma.discountRule.update({
    where: { id },
    data:  { layer, ...input },
    include: { creator: { select: { id: true, fullName: true } } },
  });
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
    data:  { isActive: false },
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
    data:  { isActive: true },
  });
};

// ─────────────────────────────────────────────────────────────────
// Preview
// ─────────────────────────────────────────────────────────────────

/**
 * Calcula descuentos SIN persistir nada.
 * Usa exactamente el mismo motor que la venta real.
 *
 * @param {object} body — { items, clientId?, paymentMethods? }
 * @param {object} user — usuario autenticado
 */
const preview = async (body, user) => {
  const storeId = user.storeId;
  if (!storeId) throw new Error('El usuario no tiene tienda asignada.');

  const { items, clientId, paymentMethods } = body;

  if (!items || items.length === 0) {
    throw new Error('Se requiere al menos un item para el preview.');
  }

  // Leer precios reales de DB (nunca del frontend)
  const productIds = items.map(i => i.id ?? i.productId);
  const dbProducts = await prisma.product.findMany({
    where:  { id: { in: productIds }, storeId },
    select: { id: true, price: true, categoryId: true },
  });
  const productMap = new Map(dbProducts.map(p => [p.id, p]));

  const cartItems = items.map(item => {
    const pid     = item.id ?? item.productId;
    const product = productMap.get(pid);
    if (!product) throw new Error(`Producto '${pid}' no encontrado en esta tienda.`);
    return {
      productId:  pid,
      categoryId: product.categoryId ?? undefined,
      quantity:   item.quantity,
      unitPrice:  product.price,
    };
  });

  const store = await prisma.store.findUnique({
    where:  { id: storeId },
    select: { maxDiscountPct: true },
  });

  // Calcular originalTotal una sola vez desde los items reales (SC-2.3)
  const originalTotal = cartItems.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);

  // ── Fase 2: Separar reglas por engineVersion (SC-2.1) ──────────
  const allRules = await prisma.discountRule.findMany({
    where: { storeId, isActive: true },
  });
  const { legacyRules, universalRules } = splitRulesByEngine(allRules);

  // ── Ejecutar motor legacy (SC-2.2) ────────────────────────────
  const legacyContext = {
    storeId,
    store: { maxDiscountPct: store?.maxDiscountPct ?? 50 },
    clientId:       clientId ?? null,
    paymentMethods: paymentMethods ?? [],
    items:          cartItems,
    rules:          legacyRules,   // inyectadas directamente — no hay segundo fetch
  };
  const legacyResult = legacyRules.length > 0
    ? await runPipeline(legacyContext)
    : { discountTotal: 0, appliedDiscounts: [], conditionalDiscounts: [], warnings: [] };

  // ── Ejecutar motor universal (SC-2.2) ─────────────────────────
  const universalContext = {
    storeId,
    clientId:       clientId ?? null,
    paymentMethods: paymentMethods ?? [],
    items:          cartItems,
  };
  const universalResult = universalRules.length > 0
    ? runUniversalPipeline(universalContext, universalRules)
    : { discountTotal: 0, appliedDiscounts: [], conditionalDiscounts: [], warnings: [] };

  // ── Merge de resultados (SC-2.3) ──────────────────────────────
  return mergeEngineResults(legacyResult, universalResult, originalTotal, allRules);
};

module.exports = { getAll, getById, create, update, deactivate, remove, activate, preview, splitRulesByEngine, mergeEngineResults };
