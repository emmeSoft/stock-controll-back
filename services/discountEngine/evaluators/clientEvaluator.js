/**
 * clientEvaluator.js — Tipo CLIENT
 * ─────────────────────────────────────────────────────────────────
 * Aplica si el cliente de la orden está en la lista permitida,
 * o si la regla aplica a todos los clientes (allClients: true).
 *
 * conditions: { clientIds?: String[], allClients?: Boolean }
 * ─────────────────────────────────────────────────────────────────
 */

/**
 * @param {object} rule
 * @param {object} context — EvaluationContext
 * @returns {ConditionResult}
 */
function evaluate(rule, context) {
  const c = rule.conditions;

  // Sin cliente en la orden → no aplica (venta anónima)
  if (!context.clientId) {
    return {
      matches: false,
      applicableItems: [],
      reason: 'No hay cliente asociado a la orden',
    };
  }

  // allClients: true → aplica a cualquier cliente registrado
  if (c.allClients === true) {
    return {
      matches: true,
      applicableItems: [], // ORDER layer
      reason: 'Descuento válido para todos los clientes registrados',
    };
  }

  // clientIds: verificar si el cliente de la orden está en la lista
  const isInList = Array.isArray(c.clientIds) && c.clientIds.includes(context.clientId);

  if (!isInList) {
    return {
      matches: false,
      applicableItems: [],
      reason: `Cliente '${context.clientId}' no está en la lista de clientes habilitados`,
    };
  }

  return {
    matches: true,
    applicableItems: [], // ORDER layer
    reason: `Cliente '${context.clientId}' habilitado para este descuento`,
  };
}

module.exports = { evaluate };
