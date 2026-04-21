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

const prisma          = require('../db/database.prisma.js');
const cajaServices    = require('./cajaServices');
const discountService = require('./discountService');
const { runPipeline } = require('./discountEngine');
const { runUniversalPipeline } = require('./discountEngine/universal');

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
  const totalPaid = paymentBreakdown.reduce((sum, p) => sum + p.amount, 0);

  // Tolerancia dinámica: max($0.01, 0.1% del total calculado).
  // Justificación: punto flotante acumula errores proporcionales al monto.
  // Una venta de $100.000 puede diferir $0.50 por redondeo legítimo de múltiples
  // descuentos; rechazarla por $0.01 sería un falso negativo.
  // El 0.1% sigue siendo lo suficientemente estricto para detectar manipulaciones reales.
  const tolerance = Math.max(0.01, computedTotal * 0.001);

  if (Math.abs(totalPaid - computedTotal) > tolerance) {
    throw new Error(
      `El total pagado ($${totalPaid.toFixed(2)}) no coincide con el total calculado ($${computedTotal.toFixed(2)}). ` +
      `Diferencia: $${Math.abs(totalPaid - computedTotal).toFixed(2)} (tolerancia: $${tolerance.toFixed(2)}). ` +
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

    // ── PASO 2: Construir cartItems usando precios de DB ─────────
    const cartItems = items.map(item => {
      const product = productMap.get(item.id);
      return {
        productId:  item.id,
        categoryId: product.categoryId ?? undefined,
        quantity:   item.quantity,
        unitPrice:  product.price,   // SEGURIDAD: precio de DB, nunca del frontend
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
    const backendBaseSubtotal = cartItems.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);
    const priceIntegrityTolerance = Math.max(0.01, backendBaseSubtotal * 0.001);
    const priceIntegrityDiff = Math.abs(Number(frontendSubtotal) - backendBaseSubtotal);
    if (priceIntegrityDiff > priceIntegrityTolerance) {
      throw new Error(
        `Desincronización de precios detectada: el valor base en pantalla ` +
        `($${Number(frontendSubtotal).toFixed(2)}) no coincide con los precios ` +
        `actuales del sistema ($${backendBaseSubtotal.toFixed(2)}). ` +
        `Diferencia: $${priceIntegrityDiff.toFixed(2)} (tolerancia: $${priceIntegrityTolerance.toFixed(2)}). ` +
        `Por favor, recargá el carrito e intentá de nuevo.`
      );
    }

    // ── PASO 3: Ejecutar motor de descuentos (PATRÓN DUAL-ENGINE) ───
    // Traer reglas de DB dentro de la tx para snapshot consistente.
    const allRules = await tx.discountRule.findMany({
      where: { storeId: effectiveStoreId, isActive: true },
    });
    const { legacyRules, universalRules } = discountService.splitRulesByEngine(allRules);

    // Calcular originalTotal una sola vez desde precios de DB
    const originalTotal = cartItems.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);

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
      items: cartItems,
    };
    const universalResult = universalRules.length > 0
      ? runUniversalPipeline(universalContext, universalRules)
      : { discountTotal: 0, appliedDiscounts: [], conditionalDiscounts: [], warnings: [] };

    // Merge resultados — pasar maxDiscountPct para que el cap aplique a ambos motores
    const discountResult = discountService.mergeEngineResults(
      legacyResult, universalResult, originalTotal, allRules,
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
        data:  { usedUnits: { increment: qty } },
      });
    }

    // ── PASO 5: Recalcular totales finales post-ajuste ───────────
    // AXIOMA: el blindaje de tienda se aplica como última línea de defensa (SC-2.3)
    // Se recalculan montos por si se removió algún LIMITED_STOCK por cupo insuficiente.
    let discountTotal = discountResult.appliedDiscounts.reduce(
      (sum, d) => sum + d.amount, 0
    );
    const computedSubtotal = cartItems.reduce(
      (sum, i) => sum + i.unitPrice * i.quantity, 0
    );

    // Re-aplicar el CAP sobre el total recalculado y ajustar desgloses
    const maxDiscountPct = store?.maxDiscountPct ?? 80;
    const maxAllowedDiscount = parseFloat(((computedSubtotal * maxDiscountPct) / 100).toFixed(2));
    
    // LOG de auditoría (Debug en Transacción)
    console.log(`[SALE CAP DEBUG] Store: ${effectiveStoreId} | MaxPct: ${maxDiscountPct} | Subtotal: ${computedSubtotal} | CurrentDisc: ${discountTotal} | MaxAllowed: ${maxAllowedDiscount}`);

    if (discountTotal > maxAllowedDiscount) {
      const ratio = maxAllowedDiscount / discountTotal;
      let adjustedSum = 0;
      
      discountResult.appliedDiscounts = discountResult.appliedDiscounts.map((d, index) => {
        // Ajuste por diferencia de redondeo en el último elemento
        if (index === discountResult.appliedDiscounts.length - 1) {
          const lastAmount = parseFloat((maxAllowedDiscount - adjustedSum).toFixed(2));
          return { ...d, amount: Math.max(lastAmount, 0) };
        }
        const newAmount = parseFloat((d.amount * ratio).toFixed(2));
        adjustedSum += newAmount;
        return { ...d, amount: newAmount };
      }).filter(d => d.amount > 0);

      discountTotal = maxAllowedDiscount;
    }

    const computedFinalTotal = Math.max(
      parseFloat((computedSubtotal - discountTotal).toFixed(2)),
      0.01
    );

    // SEGURIDAD: Validamos que lo cobrado coincida con lo que el motor calculó 
    // como precio final (post-cap), siguiendo el axioma de que se cobra el 
    // precio rebajado pero blindado por el tope de la tienda.
    validatePayments(paymentBreakdown, computedFinalTotal);

    const paymentMethodSummary = paymentBreakdown.length > 1
      ? 'COMBINADO'
      : paymentBreakdown[0].method;

    // ── PASO 7: Crear la orden con totales del motor ──────────────
    const order = await tx.order.create({
      data: {
        storeId:        effectiveStoreId,
        userId:         user.id || null,
        cashRegisterId: currentRegister.id,
        clientId:       clientId || null,
        amount:         computedFinalTotal,       // Motor, no frontend
        amoutPayed:     computedFinalTotal,
        discountTotal:  parseFloat(discountTotal.toFixed(2)),
        paymentMethod:  paymentMethodSummary,
        status:         'completed',
        statusPayment:  'paid',
        orderDetails: {
          create: cartItems.map(item => ({
            productId: item.productId,
            quantity:  item.quantity,
            price:     item.unitPrice,            // Precio de DB, no frontend
          })),
        },
      },
      include: {
        client:       true,
        user:         true,
        orderDetails: { include: { product: true } },
      },
    });

    // ── PASO 8: Registrar OrderPayments ──────────────────────────
    for (const payment of paymentBreakdown) {
      await tx.orderPayment.create({
        data: {
          orderId:       order.id,
          paymentMethod: payment.method,
          amount:        payment.amount,
        },
      });
    }

    // ── Helper: Normalizar applied discount para persistencia ────────
    // El motor universal devuelve un shape minimalista. Aquí completamos
    // los campos que necesita AppliedDiscount (type, layer, percentage, reason)
    // usando la DiscountRule como source of truth.
    async function normalizeAppliedDiscount(orderId, applied) {
      if (applied.amount <= 0) return null;
      
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
        amount: applied.amount,
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
    for (const item of cartItems) {
      const previousStock = productMap.get(item.productId).stock;

      const updated = await tx.product.update({
        where: { id: item.productId },
        data:  { stock: { decrement: item.quantity } },
      });

      await tx.stockHistory.create({
        data: {
          storeId:        effectiveStoreId,
          productId:      item.productId,
          userId:         user.id || null,
          type:           'SALE',
          previousStock,
          movementAmount: -item.quantity,
          currentStock:   updated.stock,
          description:    `Venta POS #${order.id.slice(-6)}${user.isSimulating ? ' (Simulada por SISTEMA)' : ''}`,
        },
      });
    }

    // ── Respuesta ─────────────────────────────────────────────────
    
    return {
      ...order,
      orderPayments:    paymentBreakdown,
      discountSummary: {
        originalTotal: parseFloat(computedSubtotal.toFixed(2)),
        discountTotal: parseFloat(discountTotal.toFixed(2)),
        finalTotal:    computedFinalTotal,
        applied:       discountResult.appliedDiscounts,
        conditional:   discountResult.conditionalDiscounts,
        warnings:      discountResult.warnings,
      },
    };
  }); // fin $transaction
};

// ─────────────────────────────────────────────────────────────────
// getAll / getById (sin cambios en lógica, agrego appliedDiscounts)
// ─────────────────────────────────────────────────────────────────

const getAll = async (user) => {
  const isSistema  = user.role === 'SISTEMA' || user.isSistema;
  const canSeeAll  = isSistema && !user.isGlobalOverride;
  const whereClause = canSeeAll ? {} : { storeId: user.storeId };

  return await prisma.order.findMany({
    where:   whereClause,
    orderBy: { createdAt: 'desc' },
    include: {
      client:          true,
      user:            true,
      orderDetails:    { include: { product: true } },
      orderPayments:   true,
      appliedDiscounts: true,
    },
  });
};

const getById = async (id, user) => {
  
  const whereClause = user.storeId
    ? { id: { endsWith: id }, storeId: user.storeId }
    : { id: { endsWith: id } };

  const order = await prisma.order.findFirst({
    where:   whereClause,
    include: {
      client:          true,
      user:            true,
      orderDetails:    { include: { product: true } },
      orderPayments:   true,
      appliedDiscounts: {
        include: {
          discountRule: true, // Traer la regla para obtener nombre y percentage
        },
      },
    },
  });

  if (!order) throw new Error(`Venta con ID ${id} no encontrada`);

  // Agregar discountSummary para consistencia con create
  // Calcular totals desde los descuentos aplicados
  const discountTotal = (order.appliedDiscounts || []).reduce((sum, d) => sum + d.amount, 0);
  const orderDetailsTotal = (order.orderDetails || []).reduce(
    (sum, d) => sum + d.price * d.quantity, 0
  );
  const finalTotal = order.amount;

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
      originalTotal: parseFloat((orderDetailsTotal + discountTotal).toFixed(2)),
      discountTotal: parseFloat(discountTotal.toFixed(2)),
      finalTotal:    parseFloat(finalTotal.toFixed(2)),
      applied:       enrichedDiscounts,
      conditional:   [],
      warnings:      [],
    },
  };
};

module.exports = { create, getAll, getById };
