/**
 * calculator.js — Universal Discount Engine
 * ─────────────────────────────────────────────────────────────────
 * Lógica de cálculo monetario para el motor universal.
 * 
 * Responsibilities:
 *  - simulateMonetaryImpact: proyecta cuánto descontaría una regla a un item
 *  - applyDiscount: aplica el descuento considerando límites de unidades
 *  - calculateResidualSubtotal: calcula el subtotal después de descuentos ITEM
 * ─────────────────────────────────────────────────────────────────
 */

const { money, round, toNumber, sum } = require('../../../utils/money');

const GUARD_MIN_PRICE = 0.01;

/**
 * Resuelve cuántas unidades son descontables dado un `maxUnits` opcional.
 * Si `maxUnits` no es un número, no hay tope y se usa `quantity` completa.
 * @param {number} quantity - Cantidad del item
 * @param {number|undefined} maxUnits - Tope de unidades (crudo o ya resuelto por el caller)
 * @returns {number}
 */
function resolveDiscountableQuantity(quantity, maxUnits) {
  return typeof maxUnits === 'number' ? Math.min(quantity, maxUnits) : quantity;
}

/**
 * Simula el impacto monetario de una regla sobre un item.
 * @param {Object} rule - Regla con conditionsUniversal
 * @param {Object} item - { productId, categoryId, quantity, unitPrice, originalSubtotal }
 * @returns {number} Monto que se descontaría
 */
function simulateMonetaryImpact(rule, item) {
  const conditions = rule.conditionsUniversal ?? {};
  const { target, itemConditions, constraints } = conditions;

  // Verificar si aplica a este item (target check)
  if (target) {
    const { productIds, categoryIds } = target;

    // Si tiene productIds específicos, verificar
    if (productIds?.length > 0 && !productIds.includes(item.productId)) {
      return 0;
    }

    // Si tiene categoryIds específicos, verificar
    if (categoryIds?.length > 0 && (!item.categoryId || !categoryIds.includes(item.categoryId))) {
      return 0;
    }
  }

  // Verificar itemConditions.minQuantity
  const minQuantity = itemConditions?.minQuantity ?? 0;
  if (item.quantity < minQuantity) {
    return 0;
  }

  // Respetar constraints.maxUnits para fines de SELECCIÓN de regla (qué regla
  // "gana" cuando dos compiten por el mismo item). Sin esto, el impacto
  // simulado asumía que el descuento cubría TODAS las unidades del item,
  // aunque la regla tope a menos — lo que podía hacer ganar a una regla que
  // en los hechos (ver applyDiscount) descontaría menos que la otra.
  // NOTA: esto NO redistribuye el cap entre líneas del carrito (ver
  // evaluator.js / applyDiscount) — ese es un issue separado, fuera de
  // alcance acá.
  const maxUnits = constraints?.maxUnits;
  const discountableQuantity = resolveDiscountableQuantity(item.quantity, maxUnits);

  // Calcular descuento (item.originalSubtotal puede no existir aún).
  // item.unitPrice puede ser un Prisma.Decimal real (viene de product.price) o
  // un number plano (tests) — money() soporta ambos.
  // Si maxUnits no achica la cantidad descontable, se puede reusar
  // item.originalSubtotal (ya calculado para la cantidad completa) como
  // antes. Si la achica, hay que recalcular la base sobre las unidades
  // efectivamente descontables.
  const baseSubtotal = (discountableQuantity === item.quantity)
    ? (item.originalSubtotal ?? money(item.unitPrice).times(item.quantity))
    : money(item.unitPrice).times(discountableQuantity);

  const percentage = rule.percentage ?? 0;
  const discountAmount = money(baseSubtotal).times(percentage).dividedBy(100);

  return toNumber(discountAmount);
}

/**
 * Aplica el descuento de una regla a un item, considerando maxUnits.
 * @param {Object} item - Item del carrito
 * @param {Object} rule - Regla a aplicar
 * @param {number} maxUnits - Unidades máximas que pueden usar el descuento
 * @returns {Object} Item con descuento aplicado
 */
function applyDiscount(item, rule, maxUnits) {
  const unitPrice = money(item.unitPrice);
  const quantity = item.quantity;
  const originalSubtotal = money(item.originalSubtotal ?? unitPrice.times(quantity));
  const percentage = rule.percentage ?? 0;

  // Determinar cuántas unidades aplican al descuento. `maxUnits` llega ya
  // resuelto por el caller (evaluator.js): o el `constraints.maxUnits` crudo
  // de la regla (sin pooling), o la cantidad ya repartida entre las líneas
  // que ganaron esa misma regla (ver evaluateUniversal). Antes esta función
  // ignoraba el parámetro y recalculaba `limitUnits` directamente desde
  // `rule.conditionsUniversal.constraints.maxUnits`, lo que anulaba
  // cualquier reparto hecho por el caller.
  const discountableQuantity = resolveDiscountableQuantity(quantity, maxUnits);

  // Calcular monto de descuento solo sobre las unidades aplicables.
  // AppliedDiscount.amount se redondea HALF_UP a 2 decimales (decisión de
  // rounding resuelta en el addendum de la propuesta).
  const discountableSubtotal = unitPrice.times(discountableQuantity);
  const discountAmount = round(discountableSubtotal.times(percentage).dividedBy(100));

  // Precio final = original - descuento (simple)
  const finalPrice = toNumber(originalSubtotal.minus(discountAmount));

  return {
    ...item,
    discountableQuantity,
    discountAmount: discountAmount.toNumber(),
    finalPrice,
    appliedRule: {
      ruleId: rule.id,
      amount: discountAmount.toNumber(),
    },
  };
}

/**
 * Calcula el subtotal residual después de aplicar descuentos ITEM.
 * @param {Object[]} itemsWithDiscounts - Items con descuentos aplicados
 * @returns {number} Subtotal residual
 */
function calculateResidualSubtotal(itemsWithDiscounts) {
  // finalPrice ya es el total para todas las unidades de ese item
  return toNumber(sum(itemsWithDiscounts, (item) => item.finalPrice));
}

/**
 * Encuentra la mejor regla ITEM para un item específico.
 * Usa estrategia MAXIMIZE_DISCOUNT (mayor impacto monetario).
 * @param {Object[]} itemRules - Reglas ITEM_LEVEL que aplican al item
 * @param {Object} item - Item del carrito
 * @returns {Object|null} La mejor regla o null
 */
function findBestItemRule(itemRules, item) {
  if (itemRules.length === 0) return null;

  let bestRule = null;
  let bestImpact = 0;

  for (const rule of itemRules) {
    const impact = simulateMonetaryImpact(rule, item);
    if (impact > bestImpact) {
      bestImpact = impact;
      bestRule = rule;
    }
  }

  return bestRule;
}

/**
 * Resuelve descuentos ORDER considerando isCombinable.
 * - Los combinables (isCombinable !== false) se suman
 * - Los no combinables (isCombinable === false) compiten entre sí
 * - Se elige el que mayor impacto tiene (combinables sumados vs mejor no combinable)
 * 
 * @param {Object[]} orderRules - Reglas ORDER_LEVEL
 * @param {number} residualSubtotal - Subtotal después de descuentos ITEM
 * @returns {Object|null} { rule, percentage, amount }
 */
function resolveOrderDiscounts(orderRules, residualSubtotal) {
  if (orderRules.length === 0) return null;

  // Los combinables (isCombinable !== false) se suman en cascada
  const combinable = orderRules.filter(r => r.isCombinable !== false);
  const nonCombinable = orderRules.filter(r => r.isCombinable === false);

  // 1. Calcular impacto de combinables
  let totalCombinableAmount = 0;
  let tempTotal = residualSubtotal;
  const appliedCombinable = [];

  if (combinable.length > 0) {
    // Ordenamos por prioridad para la cascada
    const sortedCombinable = [...combinable].sort((a, b) => (b.priority || 0) - (a.priority || 0));

    for (const r of sortedCombinable) {
      // Si hay _matchingAmount (regla con restricción de medio de pago),
      // siempre calcular el descuento sobre ese monto y no sobre el total.
      // allowPartial controla elegibilidad (evaluator), no la base de cálculo.
      const baseAmount = (r._matchingAmount !== undefined)
        ? Math.min(r._matchingAmount, tempTotal)
        : tempTotal;

      const impact = toNumber(money(baseAmount).times(r.percentage ?? 0).dividedBy(100));
      totalCombinableAmount = toNumber(money(totalCombinableAmount).plus(impact));
      tempTotal = toNumber(money(tempTotal).minus(impact));

      appliedCombinable.push({ ...r, _calculatedImpact: impact });
    }
  }

  // 2. Calcular mejor no combinable
  let bestNonCombinable = null;
  let bestNonCombinableAmount = 0;

  if (nonCombinable.length > 0) {
    for (const r of nonCombinable) {
      // Mismo criterio que combinables: _matchingAmount manda cuando existe.
      const baseAmount = (r._matchingAmount !== undefined)
        ? Math.min(r._matchingAmount, residualSubtotal)
        : residualSubtotal;

      const impact = toNumber(money(baseAmount).times(r.percentage ?? 0).dividedBy(100));
      if (impact > bestNonCombinableAmount) {
        bestNonCombinableAmount = impact;
        bestNonCombinable = { ...r, _calculatedImpact: impact };
      }
    }
  }

  // 3. Elegir el ganador (combinables vs mejor no combinable)
  if (totalCombinableAmount >= bestNonCombinableAmount && totalCombinableAmount > 0) {
    return {
      rule: appliedCombinable[0],
      amount: totalCombinableAmount,
      isCombinable: true,
      combinedRules: appliedCombinable,
    };
  } else if (bestNonCombinableAmount > 0) {
    return {
      rule: bestNonCombinable,
      amount: bestNonCombinableAmount,
      isCombinable: false,
      combinedRules: null,
    };
  }


  return null;
}

// ─────────────────────────────────────────────────────────────────
// Backward compatibility: wrapper que usa resolveOrderDiscounts
// ─────────────────────────────────────────────────────────────────
function findBestOrderRule(orderRules, residualSubtotal) {
  const result = resolveOrderDiscounts(orderRules, residualSubtotal);
  return result?.rule ?? null;
}

module.exports = {
  simulateMonetaryImpact,
  applyDiscount,
  calculateResidualSubtotal,
  findBestItemRule,
  findBestOrderRule, // Mantener para backward compatibility
  resolveOrderDiscounts,
  GUARD_MIN_PRICE,
};
