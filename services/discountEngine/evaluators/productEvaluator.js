/**
 * productEvaluator.js — Tipo PRODUCT
 * ─────────────────────────────────────────────────────────────────
 * Aplica sobre items cuyo productId esté en la lista de la regla.
 *
 * conditions: { productIds: String[] }
 * ─────────────────────────────────────────────────────────────────
 */

/**
 * @param {object} rule
 * @param {object} context — EvaluationContext
 * @returns {ConditionResult}
 */
function evaluate(rule, context) {
  const c = rule.conditions;
  const allowedIds = new Set(c.productIds);

  const matchingItems = context.items.filter(item => allowedIds.has(item.productId));

  if (matchingItems.length === 0) {
    return {
      matches: false,
      applicableItems: [],
      reason: `Ningún item del carrito está en la lista de productos habilitados`,
    };
  }

  return {
    matches: true,
    applicableItems: matchingItems.map(i => i.productId),
    reason: `${matchingItems.length} item(s) coinciden con los productos habilitados`,
  };
}

module.exports = { evaluate };
