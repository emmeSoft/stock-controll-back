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
 * Encuentra la mejor regla ORDER para el subtotal residual.
 * @param {Object[]} orderRules - Reglas ORDER_LEVEL
 * @param {number} residualSubtotal - Subtotal después de descuentos ITEM
 * @returns {Object|null} La mejor regla o null
 */
function findBestOrderRule(orderRules, residualSubtotal) {
  if (orderRules.length === 0) return null;
  
  let bestRule = null;
  let bestImpact = 0;
  
  for (const rule of orderRules) {
    const percentage = rule.percentage ?? 0;
    const impact = residualSubtotal * (percentage / 100);
    
    if (impact > bestImpact) {
      bestImpact = impact;
      bestRule = rule;
    }
  }
  
  return bestRule;
}

module.exports = {
  simulateMonetaryImpact,
  applyDiscount,
  calculateResidualSubtotal,
  findBestItemRule,
  findBestOrderRule,
  GUARD_MIN_PRICE,
};
