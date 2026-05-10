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

const GUARD_MIN_PRICE = 0.01;

/**
 * Simula el impacto monetario de una regla sobre un item.
 * @param {Object} rule - Regla con conditionsUniversal
 * @param {Object} item - { productId, categoryId, quantity, unitPrice, originalSubtotal }
 * @returns {number} Monto que se descontaría
 */
function simulateMonetaryImpact(rule, item) {
  const conditions = rule.conditionsUniversal ?? {};
  const { target, itemConditions } = conditions;

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

  // Calcular descuento (item.originalSubtotal puede no existir aún)
  const originalSubtotal = item.originalSubtotal ?? (item.unitPrice * item.quantity);
  const percentage = rule.percentage ?? 0;
  const discountAmount = originalSubtotal * (percentage / 100);

  return discountAmount;
}

/**
 * Aplica el descuento de una regla a un item, considerando maxUnits.
 * @param {Object} item - Item del carrito
 * @param {Object} rule - Regla a aplicar
 * @param {number} maxUnits - Unidades máximas que pueden usar el descuento
 * @returns {Object} Item con descuento aplicado
 */
function applyDiscount(item, rule, maxUnits) {
  const conditions = rule.conditionsUniversal ?? {};
  const { constraints } = conditions;

  const unitPrice = item.unitPrice;
  const quantity = item.quantity;
  const originalSubtotal = item.originalSubtotal ?? (unitPrice * quantity);
  const percentage = rule.percentage ?? 0;

  // Determinar cuántas unidades aplican al descuento
  const limitUnits = constraints?.maxUnits ?? quantity;
  const discountableQuantity = Math.min(quantity, limitUnits);

  // Calcular monto de descuento solo sobre las unidades aplicables
  const discountableSubtotal = discountableQuantity * unitPrice;
  const discountAmount = discountableSubtotal * (percentage / 100);

  // Precio final = original - descuento (simple)
  const finalPrice = originalSubtotal - discountAmount;

  return {
    ...item,
    discountableQuantity,
    discountAmount,
    finalPrice,
    appliedRule: {
      ruleId: rule.id,
      amount: discountAmount,
    },
  };
}

/**
 * Calcula el subtotal residual después de aplicar descuentos ITEM.
 * @param {Object[]} itemsWithDiscounts - Items con descuentos aplicados
 * @returns {number} Subtotal residual
 */
function calculateResidualSubtotal(itemsWithDiscounts) {
  return itemsWithDiscounts.reduce((sum, item) => {
    // finalPrice ya es el total para todas las unidades de ese item
    return sum + item.finalPrice;
  }, 0);
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

      const impact = parseFloat((baseAmount * ((r.percentage ?? 0) / 100)).toFixed(2));
      totalCombinableAmount = parseFloat((totalCombinableAmount + impact).toFixed(2));
      console.log(sortedCombinable);
      console.log("aca", {
        rule: r.name,
        percentage: r.percentage,
        tempTotal,
        baseAmount,
        impact
      });
      tempTotal = parseFloat((tempTotal - impact).toFixed(2));

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

      const impact = parseFloat((baseAmount * ((r.percentage ?? 0) / 100)).toFixed(2));
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
