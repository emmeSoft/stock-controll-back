/**
 * layerMap.js
 * ─────────────────────────────────────────────────────────────────
 * AXIOMA 1: DiscountType es un enum cerrado y capas son fijas.
 * El `layer` NO se acepta del request — siempre se deriva del tipo aquí.
 * ─────────────────────────────────────────────────────────────────
 */

const LAYER_MAP = {
  PRODUCT:       'ITEM',
  CATEGORY:      'ITEM',
  QUANTITY:      'ITEM',
  LIMITED_STOCK: 'ITEM',
  CLIENT:        'ORDER',
  CASH_PAYMENT:  'ORDER',
  SPECIAL_DATE:  'ORDER',
  MIN_AMOUNT:    'ORDER',
};

/**
 * @param {string} type — DiscountType value
 * @returns {'ITEM' | 'ORDER'}
 * @throws {Error} if type is unknown
 */
function getLayer(type) {
  const layer = LAYER_MAP[type];
  if (!layer) throw new Error(`[layerMap] Unknown DiscountType: "${type}"`);
  return layer;
}

module.exports = { LAYER_MAP, getLayer };
