/**
 * minAmountEvaluator.js — Tipo MIN_AMOUNT
 * ─────────────────────────────────────────────────────────────────
 * Aplica si el subtotal de la orden (antes de descuentos ORDER)
 * supera el monto mínimo configurado.
 *
 * Se evalúa sobre context.orderSubtotal (suma de item.price * item.quantity
 * después de aplicar descuentos ITEM, si los hay).
 *
 * conditions: { minAmount: Float }
 * ─────────────────────────────────────────────────────────────────
 */

/**
 * @param {object} rule
 * @param {object} context — EvaluationContext
 * @returns {ConditionResult}
 */
function evaluate(rule, context) {
  const c = rule.conditions;
  const subtotal = context.orderSubtotal ?? 0;

  if (subtotal < c.minAmount) {
    return {
      matches: false,
      applicableItems: [],
      reason: `Subtotal $${subtotal.toFixed(2)} no alcanza el mínimo de $${c.minAmount.toFixed(2)}`,
    };
  }

  return {
    matches: true,
    applicableItems: [], // ORDER layer
    reason: `Subtotal $${subtotal.toFixed(2)} supera el mínimo de $${c.minAmount.toFixed(2)}`,
  };
}

module.exports = { evaluate };
