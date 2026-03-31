/**
 * categoryEvaluator.js — Tipo CATEGORY
 * ─────────────────────────────────────────────────────────────────
 * Aplica sobre items cuya categoryId esté en la lista de la regla.
 * El context.items debe incluir el campo `categoryId` de cada item.
 *
 * conditions: { categoryIds: String[] }
 * ─────────────────────────────────────────────────────────────────
 */

/**
 * @param {object} rule
 * @param {object} context — EvaluationContext
 * @returns {ConditionResult}
 */
function evaluate(rule, context) {
  const c = rule.conditions;
  const allowedCategories = new Set(c.categoryIds);

  const matchingItems = context.items.filter(
    item => item.categoryId && allowedCategories.has(item.categoryId)
  );

  if (matchingItems.length === 0) {
    return {
      matches: false,
      applicableItems: [],
      reason: `Ningún item del carrito pertenece a las categorías habilitadas`,
    };
  }

  return {
    matches: true,
    applicableItems: matchingItems.map(i => i.productId),
    reason: `${matchingItems.length} item(s) pertenecen a categorías con descuento`,
  };
}

module.exports = { evaluate };
