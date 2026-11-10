/**
 * legacyWarnings.js
 * ─────────────────────────────────────────────────────────────────
 * Mensajes compartidos para reglas con `engineVersion` legacy/null
 * ignoradas (motor legacy retirado — no existe implementación real
 * detrás de él). Extraído de discountService.js y salesServices.js,
 * que repetían el mismo texto en 2 lugares cada uno (console.warn +
 * warnings de respuesta).
 * ─────────────────────────────────────────────────────────────────
 */

/**
 * Construye el mensaje de log para `console.warn` cuando aparecen
 * reglas legacy/null sin normalizar.
 *
 * @param {string} tag — etiqueta del caller (ej. '[salesServices]')
 * @param {Object[]} legacyRules — reglas ignoradas
 * @returns {string}
 */
function buildLegacyWarningLog(tag, legacyRules) {
  return `${tag} ${legacyRules.length} regla(s) con engineVersion legacy/null ignoradas (motor legacy retirado). IDs: ${legacyRules.map(r => r.id).join(', ')}`;
}

/**
 * Construye el mensaje de warning que se expone en la respuesta
 * (result.warnings / discountResult.warnings) cuando aparecen
 * reglas legacy/null sin normalizar.
 *
 * @param {Object[]} legacyRules — reglas ignoradas
 * @returns {string}
 */
function buildLegacyWarningMessage(legacyRules) {
  return `${legacyRules.length} regla(s) de descuento con engineVersion legacy fueron ignoradas (motor legacy retirado; ejecutar backfill de datos).`;
}

module.exports = { buildLegacyWarningLog, buildLegacyWarningMessage };
