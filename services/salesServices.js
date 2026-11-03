/**
 * salesServices.js
 * ─────────────────────────────────────────────────────────────────
 * Servicio de ventas con integración del Motor de Descuentos v3.
 *
 * SEGURIDAD:
 *  - Nunca se confía en precios ni totales provenientes del frontend.
 *  - Los precios se leen de la base de datos dentro de la transacción.
 *  - Los descuentos se calculan exclusivamente en el motor.
 * ─────────────────────────────────────────────────────────────────
 */

const prisma = require('../db/database.prisma.js');
const bcrypt = require('bcrypt');
const cajaServices = require('./cajaServices');
const discountService = require('./discountService');
const { runPipeline } = require('./discountEngine');
const { runUniversalPipeline } = require('./discountEngine/universal');
const currentAccountServices = require('./currentAccountServices');
const { money, round, toNumber, sum, D } = require('../utils/money');


// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

/**
 * Valida que paymentBreakdown existe, no está vacío
 * y que la suma declarada coincide con el total calculado en backend.
 *
 * @param {Array}  paymentBreakdown  — [{ method, amount }]
 * @param {number} computedTotal     — total calculado por el motor
 */
function validatePayments(paymentBreakdown, computedTotal) {
  if (!paymentBreakdown || paymentBreakdown.length === 0) {
    throw new Error('Debe ingresar al menos un medio de pago.');
  }
  const totalPaid = sum(paymentBreakdown, (p) => p.amount);
  const total = money(computedTotal);

  // Tolerancia dinámica: max($0.01, 0.1% del total calculado).
  // Justificación: punto flotante acumula errores proporcionales al monto.
  // Una venta de $100.000 puede diferir $0.50 por redondeo legítimo de múltiples
  // descuentos; rechazarla por $0.01 sería un falso negativo.
  // El 0.1% sigue siendo lo suficientemente estricto para detectar manipulaciones reales.
  const tolerance = D.max(money(0.01), total.times(0.001));

  // SEGURIDAD: Solo validamos que el total pagado sea SUFICIENTE para cubrir el total calculado.
  // Si el cliente paga de más, se asume que es vuelto o excedente contable. (SC-3.4)
  if (totalPaid.lt(total.minus(tolerance))) {
    throw new Error(
      `El total pagado ($${toNumber(totalPaid)}) es insuficiente para cubrir el total calculado ($${toNumber(total)}). ` +
      `Diferencia: $${toNumber(totalPaid.minus(total).abs())} (tolerancia: $${toNumber(tolerance)}). ` +
      'Recalculá el total antes de confirmar.'
    );
  }
}

// ─────────────────────────────────────────────────────────────────
// create
// ─────────────────────────────────────────────────────────────────

/**
 * Crea una venta aplicando el motor de descuentos.
 *
 * @param {object} saleData — { items, clientId?, paymentBreakdown, amount }
 *   items: [{ id: productId, quantity }]
 *   paymentBreakdown: [{ method, amount }]
 *   amount: number (REQUERIDO) — subtotal SIN descuentos (precio base × cantidad).
 *                               El backend lo compara contra su propio cálculo desde DB
 *                               para detectar desincronización de pantalla (ej: precios
 *                               cambiaron mientras el vendedor armaba el carrito).
 *                               NUNCA se usa para calcular descuentos ni el total a cobrar.
 *   clientId: string (opcional)
 * @param {object} user — usuario autenticado (req.user)
 */
const create = async (saleData, user) => {
  const {
    items,
    clientId,
    paymentBreakdown,
    amount: frontendSubtotal,
    preferredRuleIds = [],
    excludedRuleIds = []
  } = saleData;

  const effectiveStoreId = user.storeId;
  if (!effectiveStoreId) {
    throw new Error('Debe especificar una tienda para la venta.');
  }

  // ── Pre-checks fuera de tx (reads baratos, fallan rápido) ──────

  // Verificar cliente activo
  if (clientId) {
    const client = await prisma.client.findFirst({
      where: { id: clientId, storeId: effectiveStoreId },
    });
    if (client && client.isActive === false) {
      throw new Error('No se puede registrar la venta: El cliente seleccionado se encuentra dado de baja.');
    }
  }

  // ── Normalización de Métodos de Pago ──────────────
  // El frontend puede enviar "Cuenta Corriente", "Efectivo", etc.
  // Normalizamos a las constantes internas del sistema.
  if (Array.isArray(paymentBreakdown)) {
    paymentBreakdown.forEach(p => {
      if (p.method === "Cuenta Corriente") p.method = "CUENTA_CORRIENTE";
      // Aseguramos que otros métodos comunes estén en un formato estándar si fuera necesario
    });
  }

  // ── Validación de Cuenta Corriente ────────────────────────────
  // Si algún pago usa 'CUENTA_CORRIENTE', verificar elegibilidad ANTES de la tx.
  const hasCCPayment = (paymentBreakdown ?? []).some(p => p.method === 'CUENTA_CORRIENTE');
  if (hasCCPayment) {
    if (!clientId) {
      throw new Error('El método de pago "Cuenta Corriente" solo puede usarse con un cliente seleccionado.');
    }

    // BLINDAJE: Verificar si el usuario tiene permiso para operar con Cuentas Corrientes (account.payment)
    const rbacService = require('./rbacService');
    const hasPermission = await rbacService.checkPermission({
      userId: user.id,
      storeId: effectiveStoreId,
      permission: 'account.payment',
    });

    if (!hasPermission && user.rbacRole?.name !== 'SISTEMA') {
      throw new Error('No tenés permisos para realizar ventas a Cuenta Corriente.');
    }

    // Verificar que el cliente tiene cuenta corriente ABIERTA en esta tienda
    const ccAccount = await prisma.currentAccount.findFirst({
      where: { clientId, storeId: effectiveStoreId, status: 'OPEN' },
    });
    if (!ccAccount) {
      throw new Error('El cliente no tiene una cuenta corriente abierta en esta tienda.');
    }
  }

  // Verificar caja abierta
  const currentRegister = await cajaServices.getCurrentRegister({ ...user, storeId: effectiveStoreId });
  if (!currentRegister) {
    throw new Error('No se puede registrar la venta: Debes abrir una caja primero en esta tienda.');
  }

  // Obtener configuración de la tienda (tope de descuento)
  const store = await prisma.store.findUnique({
    where: { id: effectiveStoreId },
    select: { maxDiscountPct: true },
  });

  // ── Transacción principal ──────────────────────────────────────
  return await prisma.$transaction(async (tx) => {

    // ── PASO 1: Leer productos de DB (nunca del frontend) ────────
    const productIds = items.map(i => i.id);
    const dbProducts = await tx.product.findMany({
      where: { id: { in: productIds }, storeId: effectiveStoreId },
      select: { id: true, name: true, price: true, stock: true, categoryId: true },
    });

    const productMap = new Map(dbProducts.map(p => [p.id, p]));

    // Verificar que todos los productos existen y tienen stock
    for (const item of items) {
      const product = productMap.get(item.id);
      if (!product) {
        throw new Error(`Producto con ID ${item.id} no encontrado en esta tienda.`);
      }
      if (product.stock < item.quantity) {
        throw new Error(
          `Stock insuficiente para "${product.name}". ` +
          `Stock actual: ${product.stock}, Solicitado: ${item.quantity}.`
        );
      }
    }

    // ── PASO 1.5: Re-afirmar que la caja sigue OPEN (guard atómico) ─
    // PRIMER WRITE de la transacción (design.md Decisión 2): debe ir antes
    // de cualquier statement que tome un lock sobre una fila referenciada
    // por CashRegister (DiscountRule en PASO 4, CurrentAccount en PASO 8b,
    // Product en PASO 10) para preservar el orden de locks
    // CashRegister < DiscountRule < CurrentAccount < Product y evitar un
    // deadlock por upgrade de lock. Va DESPUÉS de PASO 1 (solo lectura, sin
    // lock) para no mover la carrera de stock detrás de esta guarda —
    // mover esto antes de PASO 1 degradaría tests/concurrency/sale-race.test.js
    // de un 409 atómico a un 400 amistoso.
    await cajaServices.assertRegisterOpen(
      tx,
      currentRegister.id,
      'La caja se cerró mientras confirmabas la venta. Abrí la caja de nuevo para continuar.'
    );

    // ── PASO 2: Construir cartItems usando precios de DB ─────────
    const cartItems = items.map(item => {
      const product = productMap.get(item.id);
      return {
        productId: item.id,
        categoryId: product.categoryId ?? undefined,
        quantity: item.quantity,
        unitPrice: product.price,   // SEGURIDAD: precio de DB, nunca del frontend
      };
    });

    // Derivar métodos de pago del paymentBreakdown
    const paymentMethods = (paymentBreakdown ?? []).map(p => p.method);

    // ── PASO 2.5: Validar integridad de precios base (Anti-Desincronización) ──
    // El frontend envía `amount` = subtotal SIN descuentos (lo que ve el vendedor/comprador).
    // El backend recalcula ese mismo subtotal desde DB y los compara ANTES de cualquier
    // cálculo de descuentos. Si difieren más del 0.1%, la sesión está desactualizada.
    //
    // SEGURIDAD: este valor NUNCA se usa para calcular descuentos ni el total a cobrar.
    // Su único propósito es detectar desincronización de pantalla.
    if (frontendSubtotal === undefined || frontendSubtotal === null) {
      throw new Error('El campo `amount` (subtotal sin descuentos) es obligatorio para registrar una venta.');
    }
    const backendBaseSubtotal = sum(cartItems, (i) => money(i.unitPrice).times(i.quantity));
    const priceIntegrityTolerance = D.max(money(0.01), backendBaseSubtotal.times(0.001));
    const priceIntegrityDiff = money(frontendSubtotal).minus(backendBaseSubtotal).abs();
    if (priceIntegrityDiff.gt(priceIntegrityTolerance)) {
      throw new Error(
        `Desincronización de precios detectada: el valor base en pantalla ` +
        `($${toNumber(frontendSubtotal)}) no coincide con los precios ` +
        `actuales del sistema ($${toNumber(backendBaseSubtotal)}). ` +
        `Diferencia: $${toNumber(priceIntegrityDiff)} (tolerancia: $${toNumber(priceIntegrityTolerance)}). ` +
        `Por favor, recargá el carrito e intentá de nuevo.`
      );
    }

    // ── PASO 3: Ejecutar motor de descuentos (PATRÓN DUAL-ENGINE) ───
    // Traer reglas de DB dentro de la tx para snapshot consistente.
    const allRules = await tx.discountRule.findMany({
      where: { storeId: effectiveStoreId, isActive: true },
    });
    const { legacyRules, universalRules } = discountService.splitRulesByEngine(allRules);

    // Calcular originalTotal una sola vez desde precios de DB (Decimal, sin
    // arrastre de punto flotante — usado para las validaciones de ESTE archivo).
    const originalTotal = sum(cartItems, (i) => money(i.unitPrice).times(i.quantity));

    // Motor legacy (retrocompatibilidad)
    const legacyContext = {
      storeId: effectiveStoreId,
      store: { maxDiscountPct: store?.maxDiscountPct ?? 80 },
      clientId: clientId ?? null,
      paymentMethods: paymentMethods ?? [],
      items: cartItems,
      rules: legacyRules,
    };
    const legacyResult = legacyRules.length > 0
      ? await runPipeline(legacyContext)
      : { discountTotal: 0, appliedDiscounts: [], conditionalDiscounts: [], warnings: [] };

    // Motor universal
    const universalContext = {
      storeId: effectiveStoreId,
      clientId: clientId ?? null,
      paymentMethods: paymentMethods ?? [],
      paymentBreakdown: paymentBreakdown ?? [],
      items: cartItems,
    };
    const universalResult = universalRules.length > 0
      ? runUniversalPipeline(universalContext, universalRules)
      : { discountTotal: 0, appliedDiscounts: [], conditionalDiscounts: [], warnings: [] };

    // Merge resultados — pasar maxDiscountPct para que el cap aplique a ambos motores.
    // NOTA (límite de alcance de esta unidad): `discountService.mergeEngineResults` es
    // código de Fase 7 (discountEngine Decimal), todavía NO migrado — sigue esperando
    // un `number` nativo y hace su propia aritmética con `* - Math.min/max` sobre
    // `originalTotal`. Esos operadores son seguros con un Decimal (siempre fuerzan
    // ToNumber, nunca concatenan string), pero pasar un `number` explícito en este
    // límite es la conversión de frontera correcta y documentada — mismo principio
    // que el export a Excel (boundary ring): servicios Decimal de punta a punta,
    // conversión explícita solo al cruzar a código aún no migrado.
    const discountResult = discountService.mergeEngineResults(
      legacyResult, universalResult, toNumber(originalTotal), allRules,
      store?.maxDiscountPct ?? 80,
      preferredRuleIds,
      excludedRuleIds
    );

    // ── PASO 4: Manejo de LIMITED_STOCK — decremento atómico ─────
    // Se filtra aquí para decrementar SOLO los que realmente aplican.
    const limitedStockDiscounts = discountResult.appliedDiscounts.filter(
      d => d.type === 'LIMITED_STOCK'
    );

    for (const ld of limitedStockDiscounts) {
      const qty = ld.discountedQty ?? 1;

      // Leer el estado actual de usedUnits dentro de la tx (evita TOCTOU)
      const rule = await tx.discountRule.findUnique({
        where: { id: ld.ruleId },
        select: { id: true, conditions: true, usedUnits: true },
      });

      if (!rule) continue; // La regla desapareció entre evaluación y persistencia — skip

      const maxUnits = rule.conditions?.maxUnits ?? 0;
      if (rule.usedUnits + qty > maxUnits) {
        // Cupo insuficiente: remover el descuento del resultado (no romper la venta)
        const idx = discountResult.appliedDiscounts.indexOf(ld);
        if (idx !== -1) discountResult.appliedDiscounts.splice(idx, 1);
        discountResult.warnings = discountResult.warnings ?? [];
        discountResult.warnings.push(
          `[LIMITED_STOCK] Regla ${rule.id}: cupo insuficiente al momento de persistir. Descuento omitido.`
        );
        continue;
      }

      // Incrementar usedUnits atómicamente dentro de la tx
      await tx.discountRule.update({
        where: { id: rule.id },
        data: { usedUnits: { increment: qty } },
      });
    }

    // ── PASO 5: Recalcular totales finales post-ajuste ───────────
    // AXIOMA: el blindaje de tienda se aplica como última línea de defensa (SC-2.3)
    // Se recalculan montos por si se removió algún LIMITED_STOCK por cupo insuficiente.
    let discountTotal = sum(discountResult.appliedDiscounts, (d) => d.amount);
    const computedSubtotal = sum(cartItems, (i) => money(i.unitPrice).times(i.quantity));

    // Re-aplicar el CAP sobre el total recalculado y ajustar desgloses
    const maxDiscountPct = store?.maxDiscountPct ?? 80;
    const maxAllowedDiscount = round(computedSubtotal.times(maxDiscountPct).dividedBy(100));

    // LOG de auditoría (Debug en Transacción)
    console.log(`[SALE CAP DEBUG] Store: ${effectiveStoreId} | MaxPct: ${maxDiscountPct} | Subtotal: ${toNumber(computedSubtotal)} | CurrentDisc: ${toNumber(discountTotal)} | MaxAllowed: ${toNumber(maxAllowedDiscount)}`);

    if (discountTotal.gt(maxAllowedDiscount)) {
      const ratio = maxAllowedDiscount.dividedBy(discountTotal);
      let adjustedSum = money(0);

      discountResult.appliedDiscounts = discountResult.appliedDiscounts.map((d, index) => {
        // Ajuste por diferencia de redondeo en el último elemento
        if (index === discountResult.appliedDiscounts.length - 1) {
          const lastAmount = round(maxAllowedDiscount.minus(adjustedSum));
          return { ...d, amount: D.max(lastAmount, money(0)) };
        }
        const newAmount = round(money(d.amount).times(ratio));
        adjustedSum = adjustedSum.plus(newAmount);
        return { ...d, amount: newAmount };
      }).filter((d) => money(d.amount).gt(0));

      discountTotal = maxAllowedDiscount;
    }

    const computedFinalTotal = D.max(
      round(computedSubtotal.minus(discountTotal)),
      money(0.01)
    );

    // SEGURIDAD: Validamos que lo cobrado coincida con lo que el motor calculó
    // EXCEPCIÓN: Si hay pago parcial por Cuenta Corriente, el total del breakdown
    // incluye el monto CC (que se registra como deuda), por lo que la suma sigue
    // siendo igual al total. Solo se omite la validación si hay CC puro (paidAmount=0).
    const ccBreakdown = paymentBreakdown.find(p => p.method === 'CUENTA_CORRIENTE');
    const ccAmount = round(money(ccBreakdown ? ccBreakdown.amount : 0));
    const cashPaid = round(computedFinalTotal.minus(ccAmount));

    if (!hasCCPayment) {
      // Venta normal: suma total debe coincidir exactamente
      validatePayments(paymentBreakdown, computedFinalTotal);
    } else {
      // CC: solo validamos que los métodos no-CC (dinero real) sean SUFICIENTES para cubrir lo esperado. (SC-3.4)
      const nonCCPayments = paymentBreakdown.filter(p => p.method !== 'CUENTA_CORRIENTE');
      const nonCCTotal = sum(nonCCPayments, (p) => p.amount);

      const tolerance = D.max(money(0.01), money(cashPaid).times(0.001));

      if (nonCCTotal.lt(money(cashPaid).minus(tolerance))) {
        throw new Error(
          `Los pagos en efectivo/tarjeta ($${toNumber(nonCCTotal)}) son insuficientes. ` +
          `Se esperaba al menos $${toNumber(cashPaid)} (Total $${toNumber(computedFinalTotal)} - CC $${toNumber(ccAmount)}).`
        );
      }
    }

    const paymentMethodSummary = hasCCPayment
      ? (paymentBreakdown.filter(p => p.method !== 'CUENTA_CORRIENTE').length > 0 ? 'COMBINADO' : 'CUENTA_CORRIENTE')
      : (paymentBreakdown.length > 1 ? 'COMBINADO' : paymentBreakdown[0].method);

    const orderStatusPayment = hasCCPayment && ccAmount.gt(0)
      ? (cashPaid.isZero() ? 'pending' : 'partial')
      : 'paid';

    // ── PASO 7: Crear la orden con totales del motor ──────────────
    const order = await tx.order.create({
      data: {
        storeId: effectiveStoreId,
        userId: user.id || null,
        cashRegisterId: currentRegister.id,
        clientId: clientId || null,
        amount: computedFinalTotal,       // Motor, no frontend
        amoutPayed: cashPaid,
        amoutToPaid: ccAmount,
        discountTotal: round(discountTotal),
        paymentMethod: paymentMethodSummary,
        status: 'completed',
        statusPayment: orderStatusPayment,
        orderDetails: {
          create: cartItems.map(item => ({
            productId: item.productId,
            quantity: item.quantity,
            price: item.unitPrice,            // Precio de DB, no frontend
          })),
        },
      },
      include: {
        client: true,
        user: true,
        orderDetails: { include: { product: true } },
      },
    });


    // ── PASO 8: Registrar OrderPayments ──────────────────────────
    for (const payment of paymentBreakdown) {
      await tx.orderPayment.create({
        data: {
          orderId: order.id,
          paymentMethod: payment.method,
          amount: payment.amount,
        },
      });
    }

    // ── PASO 8b: Registrar deuda en Cuenta Corriente (si aplica) ─
    let ccMovement = null;
    if (hasCCPayment && ccAmount.gt(0)) {
      const ccResult = await currentAccountServices.addSaleDebt(tx, {
        orderId: order.id,
        clientId,
        storeId: effectiveStoreId,
        userId: user.id,
        totalAmount: computedFinalTotal,
        paidAmount: cashPaid,
      });
      ccMovement = ccResult.movement;
    }

    // ── Helper: Normalizar applied discount para persistencia ────────
    // El motor universal devuelve un shape minimalista. Aquí completamos
    // los campos que necesita AppliedDiscount (type, layer, percentage, reason)
    // usando la DiscountRule como source of truth.
    async function normalizeAppliedDiscount(orderId, applied) {
      if (money(applied.amount).lte(0)) return null;

      // Buscar la regla para obtener metadata
      const rule = await tx.discountRule.findUnique({
        where: { id: applied.ruleId },
        select: {
          id: true,
          type: true,
          layer: true,
          percentage: true,
          name: true,
          description: true,
          engineVersion: true
        },
      });

      if (!rule) {
        console.warn(`AppliedDiscount: rule ${applied.ruleId} no encontrada, saltando`);
        return null;
      }

      // Derivar layer si no existe (para universales)
      let layer = rule.layer;
      if (!layer && rule.engineVersion === 'universal') {
        // universales: tiene target = ITEM, sin target = ORDER
        // esto ya debería estar en la regla, pero fallback
        layer = applied.productId ? 'ITEM' : 'ORDER';
      }

      // type puede ser null para universales - usar null en vez de inventar
      const type = rule.type;

      // percentage real: usar el de la regla (puede ser diferente al aplicado si hay topes)
      const percentage = rule.percentage;

      // reason:优先 nombre de regla, luego descripción, luego default
      const reason = rule.name || rule.description || `Descuento ${rule.id}`;

      return {
        orderId,
        discountRuleId: applied.ruleId,
        type,
        layer,
        percentage,
        // HALF_UP a 2 decimales en la capa de ítem — AppliedDiscount.amount era
        // Float sin redondear antes de este cambio (addendum Q2 de proposal.md);
        // ahora se redondea igual que el resto de los montos de la venta.
        amount: round(applied.amount),
        productId: applied.productId ?? null,
        discountedQuantity: applied.discountedQty ?? applied.quantity ?? null,
        reason,
      };
    }

    // ── PASO 9: Persistir descuentos aplicados (auditoría) ───────
    // AXIOMA 13: solo se persisten descuentos con amount > 0
    for (const applied of discountResult.appliedDiscounts) {
      const normalized = await normalizeAppliedDiscount(order.id, applied);
      if (!normalized) continue;

      await tx.appliedDiscount.create({
        data: normalized,
      });
    }

    // ── PASO 10: Descontar stock y registrar historial ────────────
    // Atomicidad: el chequeo "hay stock suficiente" y el decremento son UN
    // SOLO statement atómico a nivel DB (`updateMany` con `WHERE stock: { gte:
    // quantity } }`), nunca un read-then-write. El pre-check de ~171
    // (`product.stock < item.quantity`) se mantiene SOLO como atajo para un
    // error rápido y amable en el caso NO concurrente — este guard atómico,
    // dentro de la misma $transaction que el resto de la venta, es la única
    // fuente de verdad real contra dos ventas concurrentes por la última
    // unidad. `count === 0` revierte TODA la venta (el throw está dentro del
    // callback de $transaction).
    for (const item of cartItems) {
      const { count } = await tx.product.updateMany({
        where: { id: item.productId, storeId: effectiveStoreId, stock: { gte: item.quantity } },
        data: { stock: { decrement: item.quantity } },
      });

      if (count === 0) {
        throw Object.assign(
          new Error(
            `Stock insuficiente para "${productMap.get(item.productId)?.name ?? item.productId}": ` +
            'otra venta lo consumió primero. Recargá el carrito e intentá de nuevo.'
          ),
          { status: 409 }
        );
      }

      // `updateMany` solo devuelve { count } — re-leer SIEMPRE el estado
      // post-escritura; previousStock/currentStock se derivan de este valor,
      // nunca del `productMap` pre-lectura (mismo patrón que registerPayment/close).
      const post = await tx.product.findUnique({
        where: { id: item.productId },
        select: { stock: true },
      });

      await tx.stockHistory.create({
        data: {
          storeId: effectiveStoreId,
          productId: item.productId,
          userId: user.id || null,
          type: 'SALE',
          previousStock: post.stock + item.quantity,
          movementAmount: -item.quantity,
          currentStock: post.stock,
          description: `Venta POS #${order.id.slice(-6)}${user.isSimulating ? ' (Simulada por SISTEMA)' : ''}`,
        },
      });
    }

    // ── Respuesta ─────────────────────────────────────────────────
    // Devuelve Decimal end-to-end — el serializer global de res.json
    // (middlewares/decimalSerializer.js, Unit 2) convierte a Number en la
    // respuesta HTTP real. Los tests que llaman a create() directamente
    // deben usar `toNumber()` sobre estos campos.
    return {
      ...order,
      orderPayments: paymentBreakdown,
      discountSummary: {
        originalTotal: round(computedSubtotal),
        discountTotal: round(discountTotal),
        finalTotal: computedFinalTotal,
        applied: discountResult.appliedDiscounts,
        conditional: discountResult.conditionalDiscounts,
        warnings: discountResult.warnings,
      },
      currentAccount: ccMovement ? {
        paidAmount: cashPaid,
        debtAmount: ccAmount,
        balanceAfter: ccMovement.balanceAfter,
      } : null,
    };
  }); // fin $transaction
};


// ─────────────────────────────────────────────────────────────────
// getAll / getById (sin cambios en lógica, agrego appliedDiscounts)
// ─────────────────────────────────────────────────────────────────

const getAll = async (user) => {
  const isSistema = user.role === 'SISTEMA' || user.isSistema;
  const canSeeAll = isSistema && !user.isGlobalOverride;
  const whereClause = canSeeAll ? {} : { storeId: user.storeId };

  return await prisma.order.findMany({
    where: whereClause,
    orderBy: { createdAt: 'desc' },
    include: {
      client: true,
      user: true,
      orderDetails: { include: { product: true } },
      orderPayments: true,
      appliedDiscounts: true,
    },
  });
};

const getById = async (id, user) => {

  const whereClause = user.storeId
    ? { id: { endsWith: id }, storeId: user.storeId }
    : { id: { endsWith: id } };

  const order = await prisma.order.findFirst({
    where: whereClause,
    include: {
      client: true,
      user: true,
      orderDetails: { include: { product: true } },
      orderPayments: true,
      appliedDiscounts: {
        include: {
          discountRule: true, // Traer la regla para obtener nombre y percentage
        },
      },
    },
  });

  if (!order) throw new Error(`Venta con ID ${id} no encontrada`);

  // Agregar discountSummary para consistencia con create
  // Calcular totals desde los descuentos aplicados.
  // `d.amount`/`order.amount`/`d.price` llegan de DB como Prisma.Decimal
  // (schema Decimal(12,2) desde Unit 1) — `sum`/`money` evitan el bug de
  // concatenación de string que produce el operador nativo `+` sobre un
  // Decimal crudo (ver utils/money.js).
  const discountTotal = sum(order.appliedDiscounts || [], (d) => d.amount);
  const orderDetailsTotal = sum(order.orderDetails || [], (d) => money(d.price).times(d.quantity));
  const finalTotal = money(order.amount);

  // Enriquecer appliedDiscounts para que incluyan name y percentage desde la regla
  const enrichedDiscounts = (order.appliedDiscounts || []).map(d => {
    // Usar nombre de la regla, sino el reason guardado, sino default
    const name = d.discountRule?.name || d.discountRule?.description || d.reason || `Descuento`;
    // Usar percentage de la regla, sino el guardado
    const percentage = d.discountRule?.percentage ?? d.percentage;

    return {
      ...d,
      name,
      percentage,
    };
  });

  return {
    ...order,
    discountSummary: {
      originalTotal: round(orderDetailsTotal.plus(discountTotal)),
      discountTotal: round(discountTotal),
      finalTotal: round(finalTotal),
      applied: enrichedDiscounts,
      conditional: [],
      warnings: [],
    },
  };
};

// ─────────────────────────────────────────────────────────────────
// cancel
// ─────────────────────────────────────────────────────────────────

/**
 * Anula una venta completada.
 *
 * SEGURIDAD:
 *  - Se verifica que el usuario tenga el permiso `sale.cancel` en la ruta (RBAC).
 *  - Se requiere la contraseña del usuario para confirmar la operación.
 *  - El stock se revierte atómicamente junto con el cambio de estado.
 *
 * @param {string} orderId  — ID de la venta a anular
 * @param {string} password — Contraseña del usuario para confirmar
 * @param {object} user     — Usuario autenticado (req.user)
 */
const cancel = async (orderId, password, user) => {

  // ── 1. Verificar contraseña ANTES de cualquier operación ────────
  const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
  if (!dbUser) {
    throw Object.assign(new Error('Usuario no encontrado.'), { status: 401 });
  }

  const isPasswordValid = await bcrypt.compare(password, dbUser.password);
  if (!isPasswordValid) {
    throw Object.assign(
      new Error('Contraseña incorrecta. La anulación fue rechazada.'),
      { status: 401 }
    );
  }

  // ── 2. Buscar la venta (scope por tienda) ──────────────────────
  const order = await prisma.order.findFirst({
    where: {
      id: orderId,
      ...(user.storeId ? { storeId: user.storeId } : {}),
    },
    include: {
      orderDetails: { include: { product: true } },
    },
  });

  if (!order) {
    throw Object.assign(
      new Error(`Venta con ID ${orderId} no encontrada.`),
      { status: 404 }
    );
  }

  if (order.status === 'CANCELLED') {
    throw Object.assign(
      new Error('Esta venta ya fue anulada previamente.'),
      { status: 400 }
    );
  }

  // ── 3. Transacción: anular + revertir stock + historial ────────
  return await prisma.$transaction(async (tx) => {

    // 3.1 Marcar la venta como CANCELLED
    const cancelledOrder = await tx.order.update({
      where: { id: orderId },
      data: {
        status: 'CANCELLED',
        statusPayment: 'cancelled',
      },
    });

    // 3.2 Revertir stock y registrar historial por cada ítem.
    // `increment` es una operación atómica relativa por naturaleza (no es
    // uno de los 4 sitios TOCTOU del design — mismo razonamiento que
    // `addSaleDebt`), no necesita un guard `updateMany`+count. Pero
    // `previousStock` SIEMPRE se deriva del estado POST-escritura, nunca de
    // `detail.product.stock` (leído en el `findFirst` del paso 2, ANTES de
    // esta transacción) — ese valor puede estar obsoleto si cualquier otra
    // operación tocó el stock entre ambos puntos. Mismo patrón que PASO 10
    // de `create`.
    for (const detail of order.orderDetails) {
      const updatedProduct = await tx.product.update({
        where: { id: detail.productId },
        data: { stock: { increment: detail.quantity } },
      });

      const previousStock = updatedProduct.stock - detail.quantity;

      await tx.stockHistory.create({
        data: {
          storeId: order.storeId,
          productId: detail.productId,
          userId: user.id || null,
          type: 'RETURN',
          previousStock,
          movementAmount: detail.quantity,   // Positivo: se devuelve al stock
          currentStock: updatedProduct.stock,
          description: `Devolución por anulación de venta #${orderId.slice(-6).toUpperCase()}`,
        },
      });
    }

    // 3.3 Reversión de deuda en Cuenta Corriente, si la venta tuvo CC.
    // `orderId` es @unique en CurrentAccountMovement — nunca hay más de un
    // movimiento por venta. Si existe y generó deuda real (debtAmount > 0),
    // se revierte con un movimiento NUEVO de tipo ADJUSTMENT: nunca se
    // reutiliza ni se borra el movimiento original (es el registro de
    // auditoría de la venta) y nunca se conecta `orderId` en el nuevo
    // movimiento (ese campo es @unique y ya está tomado por el original).
    // Una venta pagada 100% en efectivo nunca tuvo este movimiento — el
    // `findUnique` devuelve null y este bloque no toca CurrentAccount.
    const originalMovement = await tx.currentAccountMovement.findUnique({
      where: { orderId },
    });

    if (originalMovement && money(originalMovement.debtAmount).gt(0)) {
      const updatedAccount = await tx.currentAccount.update({
        where: { id: originalMovement.currentAccountId },
        data: { balance: { decrement: originalMovement.debtAmount } },
      });

      await tx.currentAccountMovement.create({
        data: {
          currentAccount: { connect: { id: originalMovement.currentAccountId } },
          user:           { connect: { id: user.id } },
          type:           'ADJUSTMENT',
          totalAmount:    money(0),
          paidAmount:     money(0),
          debtAmount:     money(originalMovement.debtAmount).negated(),
          balanceAfter:   updatedAccount.balance,
          description:    `Anulación de venta #${orderId.slice(-6).toUpperCase()}`,
        },
      });
    }

    return cancelledOrder;
  });
};

module.exports = { create, getAll, getById, cancel };

// REFRESH: Forzando reinicio para asegurar carga de validación flexible (SC-3.4)
