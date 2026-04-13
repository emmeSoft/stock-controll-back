/**
 * discountEngine/index.js
 * ─────────────────────────────────────────────────────────────────
 * Entry point del Motor Universal de Descuentos.
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
 *   //   items:              [...],
 *   //   orderDiscount:      {...},
 *   // }
 * ─────────────────────────────────────────────────────────────────
 */

const { runUniversalPipeline } = require('./universal');
const { validateConditionsDual, validateConditionsUniversal, validateDiscountRule } = require('./validators');
const {
  DEFAULT_PRIORITIES,
  ORDER_COMBINABLE_TYPES,
  GUARD_MIN_PRICE,
  DEFAULT_STORE_CAP_PCT,
} = require('./constants');

module.exports = {
  // API principal — Motor Universal
  runPipeline: runUniversalPipeline,

  // Validaciones
  validateConditionsDual,
  validateConditionsUniversal,
  validateDiscountRule,

  // Constantes expuestas (útiles para seeders y servicios)
  DEFAULT_PRIORITIES,
  ORDER_COMBINABLE_TYPES,
  GUARD_MIN_PRICE,
  DEFAULT_STORE_CAP_PCT,
};
