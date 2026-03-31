/**
 * cashPaymentEvaluator.js — Tipo CASH_PAYMENT
 * ─────────────────────────────────────────────────────────────────
 * AXIOMA 4: El descuento por efectivo aplica ÚNICAMENTE cuando el
 * 100% del pago es en efectivo. Pago combinado = NO MATCH.
 *
 * Caso especial — Preview sin método de pago:
 * Si paymentMethods está vacío (el vendedor aún no eligió),
 * el resultado es `isConditional: true`. El pipeline lo coloca
 * en `conditionalDiscounts` para informar al vendedor (AXIOMA 11).
 *
 * conditions: { paymentMethods: String[] }
 * ─────────────────────────────────────────────────────────────────
 */

/**
 * @param {object} rule
 * @param {object} context — EvaluationContext
 * @returns {ConditionResult}
 */
function evaluate(rule, context) {
  const c = rule.conditions;

  // Preview sin método seleccionado → descuento condicional (AXIOMA 11)
  if (!context.paymentMethods || context.paymentMethods.length === 0) {
    return {
      matches:       false,
      applicableItems: [],
      isConditional: true,
      reason:        'Método de pago no seleccionado — descuento condicional',
    };
  }

  // AXIOMA 4: pago combinado = NO MATCH, sin excepción
  if (context.paymentMethods.length > 1) {
    return {
      matches:       false,
      applicableItems: [],
      reason:        'Pago combinado — CASH_PAYMENT no aplica (AXIOMA 4)',
    };
  }

  // Único método — verificar que esté en la lista de métodos permitidos
  const selectedMethod = context.paymentMethods[0].toUpperCase();
  const allowedMethods = c.paymentMethods.map(m => m.toUpperCase());

  if (!allowedMethods.includes(selectedMethod)) {
    return {
      matches:       false,
      applicableItems: [],
      reason:        `Método de pago '${selectedMethod}' no está en la lista permitida: ${allowedMethods.join(', ')}`,
    };
  }

  return {
    matches:       true,
    applicableItems: [], // ORDER layer — no aplica a items específicos
    reason:        `Pago 100% en efectivo: ${selectedMethod}`,
  };
}

module.exports = { evaluate };
