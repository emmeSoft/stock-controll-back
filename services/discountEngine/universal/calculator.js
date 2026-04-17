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
  
  // Por compatibilidad hacia atrás: si no existe isCombinable, asumir true
  const combinable = orderRules.filter(r => r.isCombinable !== false);
  const nonCombinable = orderRules.filter(r => r.isCombinable === false);
  
  // Los combinables se suman
  let totalCombinablePct = 0;
  let combinableRule = null;
  
  if (combinable.length > 0) {
    totalCombinablePct = combinable.reduce((sum, r) => sum + (r.percentage ?? 0), 0);
    combinableRule = combinable[0]; // Usar el primero como referencia (todos tienen mismo objetivo)
  }
  
  // Los no combinables compiten entre sí
  let bestNonCombinable = null;
  let bestNonCombinablePct = 0;
  
  if (nonCombinable.length > 0) {
    bestNonCombinable = nonCombinable.reduce((best, r) => {
      const pct = r.percentage ?? 0;
      return pct > (best?.percentage ?? 0) ? r : best;
    }, null);
    bestNonCombinablePct = bestNonCombinable.percentage ?? 0;
  }
  
  // Si no hay no combinables, devolver combinables
  if (!bestNonCombinable) {
    if (!combinableRule) return null;
    return {
      rule: combinableRule,
      percentage: totalCombinablePct,
      amount: residualSubtotal * (totalCombinablePct / 100),
      isCombinable: true,
      combinedRules: combinable,
    };
  }
  
  // Si no hay combinables, devolver mejor no combinable
  if (!combinableRule) {
    return {
      rule: bestNonCombinable,
      percentage: bestNonCombinablePct,
      amount: residualSubtotal * (bestNonCombinablePct / 100),
      isCombinable: false,
      combinedRules: null,
    };
  }
  
  // Elegir el que mayor impacto tiene
  const combinableImpact = residualSubtotal * (totalCombinablePct / 100);
  const nonCombinableImpact = residualSubtotal * (bestNonCombinablePct / 100);
  
  if (combinableImpact >= nonCombinableImpact) {
    return {
      rule: combinableRule,
      percentage: totalCombinablePct,
      amount: combinableImpact,
      isCombinable: true,
      combinedRules: combinable,
    };
  } else {
    return {
      rule: bestNonCombinable,
      percentage: bestNonCombinablePct,
      amount: nonCombinableImpact,
      isCombinable: false,
      combinedRules: null,
    };
  }
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
