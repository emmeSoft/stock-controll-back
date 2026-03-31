/**
 * quantityEvaluator.js — Tipo QUANTITY
 * ─────────────────────────────────────────────────────────────────
 * Aplica si algún item del carrito alcanza el mínimo de unidades.
 * conditions: { minQuantity: Int, productId?: String, categoryId?: String }
 * ─────────────────────────────────────────────────────────────────
 */

/**
 * @param {object} rule
 * @param {object} context — EvaluationContext
 * @returns {ConditionResult}
 */
function evaluate(rule, context) {
  const c = rule.conditions;

  const matchingItems = context.items.filter(item => {
    // Si la regla filtra por producto específico
    if (c.productId && item.productId !== c.productId) return false;
    // Si la regla filtra por categoría específica
    if (c.categoryId && item.categoryId !== c.categoryId) return false;
    // Criterio principal: cantidad >= mínimo
    return item.quantity >= c.minQuantity;
  });

  if (matchingItems.length === 0) {
    return {
      matches: false,
      applicableItems: [],
      reason: `Ningún item alcanza la cantidad mínima de ${c.minQuantity} unidades`,
    };
  }

  return {
    matches: true,
    applicableItems: matchingItems.map(i => i.productId),
    reason: `${matchingItems.length} item(s) con cantidad >= ${c.minQuantity}`,
  };
}

module.exports = { evaluate };
