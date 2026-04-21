/**
 * index.js — Universal Discount Engine
 * ─────────────────────────────────────────────────────────────────
 * Entry point del Motor Universal de Descuentos.
 * Expone la API pública del módulo paralelo.
 * 
 * USO:
 *   const { runUniversalPipeline } = require('./services/discountEngine/universal');
 * 
 *   const result = await runUniversalPipeline({
 *     storeId: 'store-123',
 *     items: [
 *       { productId: 'p1', categoryId: 'cat-1', quantity: 3, unitPrice: 1000 },
 *       { productId: 'p2', categoryId: 'cat-2', quantity: 1, unitPrice: 500 },
 *     ],
 *     clientId: 'client-abc',
 *     paymentMethods: ['CASH'],
 *   }, rules);
 * 
 *   // result: {
 *   //   originalTotal: 3500,
 *   //   discountTotal: 350,
 *   //   finalTotal: 3150,
 *   //   appliedDiscounts: [...],
 *   //   items: [...],
 *   //   orderDiscount: {...},
 *   // }
 * ─────────────────────────────────────────────────────────────────
 */

const { evaluateUniversal } = require('./evaluator');
const {
  simulateMonetaryImpact,
  applyDiscount,
  calculateResidualSubtotal,
  findBestItemRule,
  findBestOrderRule,
  GUARD_MIN_PRICE,
} = require('./calculator');

/**
 * Pipeline principal del motor universal.
 * @param {Object} context - Contexto de evaluación
 * @param {Object[]} rules - Reglas de descuento con engineVersion='universal'
 * @returns {Object} Resultado con descuentos aplicados
 * 
 * @param {string} context.storeId - ID de la tienda
 * @param {Object[]} context.items - [{ productId, categoryId, quantity, unitPrice }]
 * @param {string} [context.clientId] - ID del cliente (opcional)
 * @param {string[]} [context.paymentMethods] - Métodos de pago (opcional)
 * @param {number} [context.orderSubtotal] - Subtotal de la orden (calculado si no viene)
 * @param {Date} [context.now] - Fecha actual (para tests)
 */
function runUniversalPipeline(context, rules) {

  // Filtrar solo reglas con engineVersion='universal'
  const universalRules = rules.filter(r => r.engineVersion === 'universal');

  // Si no hay reglas universales, retornar resultado vacío
  if (universalRules.length === 0) {

    const originalTotal = context.items.reduce((sum, item) => {
      return sum + (item.unitPrice * item.quantity);
    }, 0);

    return {
      originalTotal,
      discountTotal: 0,
      finalTotal: originalTotal,
      appliedDiscounts: [],
      items: context.items.map(item => ({
        ...item,
        originalSubtotal: item.unitPrice * item.quantity,
        discountableQuantity: 0,
        discountAmount: 0,
        finalPrice: item.unitPrice,
        appliedRule: null,
      })),
      orderDiscount: null,
    };
  }

  return evaluateUniversal(context, universalRules);
}

module.exports = {
  // API principal
  runUniversalPipeline,

  // Utilidades expuestas (para testing y debugging)
  evaluateUniversal,

  // Funciones del calculator
  simulateMonetaryImpact,
  applyDiscount,
  calculateResidualSubtotal,
  findBestItemRule,
  findBestOrderRule,

  // Constantes
  GUARD_MIN_PRICE,
};
