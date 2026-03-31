/**
 * limitedStockEvaluator.js — Tipo LIMITED_STOCK
 * ─────────────────────────────────────────────────────────────────
 * Aplica si el producto está en la lista Y quedan unidades disponibles
 * en el contador de la regla (maxUnits - usedUnits).
 *
 * CONCURRENCIA: Este evaluador solo EVALÚA si hay cupo.
 * El decremento atómico de usedUnits ocurre en la fase de
 * persistencia (dentro de prisma.$transaction), NO aquí.
 * Esto evita double-spending sin necesidad de locks en esta capa.
 *
 * conditions: { productIds: String[], maxUnits: Int }
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

  // Cupo disponible según el snapshot al momento de evaluar
  const remainingUnits = c.maxUnits - (rule.usedUnits ?? 0);

  if (remainingUnits <= 0) {
    return {
      matches: false,
      applicableItems: [],
      reason: `Promoción LIMITED_STOCK agotada (${c.maxUnits}/${c.maxUnits} unidades usadas)`,
    };
  }

  const matchingItems = context.items.filter(item => allowedIds.has(item.productId));

  if (matchingItems.length === 0) {
    return {
      matches: false,
      applicableItems: [],
      reason: 'Ningún item del carrito está en los productos de la promoción limitada',
    };
  }

  // Calcular cuántas unidades del carrito aplican respetando el cupo
  let totalRequested = 0;
  const applicableItems = [];

  for (const item of matchingItems) {
    const unitsToApply = Math.min(item.quantity, remainingUnits - totalRequested);
    if (unitsToApply <= 0) break;
    totalRequested += unitsToApply;
    applicableItems.push({
      productId: item.productId,
      applicableQuantity: unitsToApply,
    });
  }

  return {
    matches: true,
    // applicableItems aquí devuelve objetos enriquecidos con quantity parcial
    applicableItems: applicableItems.map(i => i.productId),
    applicableQuantities: applicableItems, // usado por el pipeline para LIMITED_STOCK
    remainingUnits,
    reason: `Promoción limitada activa — ${remainingUnits} unidades disponibles de ${c.maxUnits}`,
  };
}

module.exports = { evaluate };
