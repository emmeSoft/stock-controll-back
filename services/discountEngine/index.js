/**
 * discountEngine/index.js
 * ─────────────────────────────────────────────────────────────────
 * Entry point del Motor de Descuentos v3.
 * Expone únicamente la API pública del módulo.
 *
 * USO:
 *   const { runPipeline } = require('./services/discountEngine');
 *
 *   const result = await runPipeline({
 *     storeId:        'store-123',
 *     prisma,                          // cliente Prisma (o inyectar rules directo en tests)
 *     store:          { maxDiscountPct: 40 },
 *     clientId:       'client-abc',    // opcional
 *     paymentMethods: ['CASH'],        // opcional; vacío = preview condicional
 *     items: [
 *       { productId: 'p1', categoryId: 'cat-1', quantity: 3, unitPrice: 1000 },
 *       { productId: 'p2', categoryId: 'cat-2', quantity: 1, unitPrice: 500  },
 *     ],
 *   });
 *
 *   // result: {
 *   //   originalTotal:      3500,
 *   //   discountTotal:      350,
 *   //   finalTotal:         3150,
 *   //   appliedDiscounts:   [...],
 *   //   conditionalDiscounts: [...],
 *   //   warnings:           [...],
 *   // }
 * ─────────────────────────────────────────────────────────────────
 */

const { runPipeline }       = require('./pipeline');
const { validateConditions} = require('./validators');
const { getLayer, LAYER_MAP } = require('./layerMap');
const {
  DEFAULT_PRIORITIES,
  ORDER_COMBINABLE_TYPES,
  GUARD_MIN_PRICE,
  DEFAULT_STORE_CAP_PCT,
} = require('./constants');

module.exports = {
  // API principal
  runPipeline,

  // Utilidades expuestas (útiles para el servicio de gestión de reglas)
  validateConditions,
  getLayer,

  // Constantes expuestas (útiles para seeders y servicios)
  LAYER_MAP,
  DEFAULT_PRIORITIES,
  ORDER_COMBINABLE_TYPES,
  GUARD_MIN_PRICE,
  DEFAULT_STORE_CAP_PCT,
};
