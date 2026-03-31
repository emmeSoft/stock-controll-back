/**
 * specialDateEvaluator.js — Tipo SPECIAL_DATE
 * ─────────────────────────────────────────────────────────────────
 * La vigencia temporal se controla con startsAt/endsAt del modelo
 * (ya filtrada en el pipeline). Este evaluador sólo verifica
 * recurrencia si está configura en conditions.
 *
 * conditions: { recurrence?: 'YEARLY' | 'ONCE' }
 *   - 'ONCE'   → aplica solo en el rango startsAt..endsAt exacto
 *   - 'YEARLY' → aplica cada año en el mismo rango mes/día
 *   - undefined → equivale a 'ONCE'
 *
 * Nota: El filtrado de vigencia base (startsAt/endsAt) lo hace el
 * pipeline ANTES de llamar a este evaluador. Aquí solo manejamos
 * YEARLY (recurrencia anual).
 * ─────────────────────────────────────────────────────────────────
 */

/**
 * @param {object} rule
 * @param {object} context — EvaluationContext
 * @returns {ConditionResult}
 */
function evaluate(rule, context) {
  const c = rule.conditions;
  const recurrence = c.recurrence ?? 'ONCE';

  // Si no hay recurrencia YEARLY, la validación de fecha la hizo el pipeline
  if (recurrence !== 'YEARLY') {
    return {
      matches: true,
      applicableItems: [], // ORDER layer
      reason: 'Descuento por fecha especial activo',
    };
  }

  // YEARLY: verificar que la fecha actual esté en el rango mes/día (sin importar el año)
  if (!rule.startsAt || !rule.endsAt) {
    return {
      matches: true,
      applicableItems: [],
      reason: 'Descuento anual sin rango de fechas definido — activo',
    };
  }

  const now = context.now ? new Date(context.now) : new Date();
  const currentYear = now.getFullYear();

  // Proyectar startsAt y endsAt al año actual
  const start = new Date(rule.startsAt);
  const end = new Date(rule.endsAt);

  const startThisYear = new Date(currentYear, start.getMonth(), start.getDate(), 0, 0, 0);
  const endThisYear   = new Date(currentYear, end.getMonth(),   end.getDate(),   23, 59, 59);

  const inRange = now >= startThisYear && now <= endThisYear;

  if (!inRange) {
    return {
      matches: false,
      applicableItems: [],
      reason: `Fecha especial YEARLY — fuera de rango para el año ${currentYear}`,
    };
  }

  return {
    matches: true,
    applicableItems: [], // ORDER layer
    reason: `Descuento por fecha especial anual activo (${startThisYear.toLocaleDateString()} – ${endThisYear.toLocaleDateString()})`,
  };
}

module.exports = { evaluate };
