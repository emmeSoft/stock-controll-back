/**
 * payment-breakdown-proportion.test.js
 * ─────────────────────────────────────────────────────────────────
 * Cubre la fórmula de proporción por medio de pago introducida en
 * `validateTicketConditions` (services/discountEngine/universal/evaluator.js):
 *
 *   proporción_método = amount_método / totalPagado
 *   montoCorrespondiente_método = proporción_método × context.orderSubtotal
 *
 * Reemplazó a un campo `p.baseAmount` que calculaba el FRONTEND (violaba
 * la regla de este proyecto de que ningún monto usado para descuentos
 * puede venir del cliente — ver cabecera de salesServices.js). Nada
 * ejercitaba `context.paymentBreakdown` para este path hasta este test.
 *
 * Verifica:
 *   (a) con 2+ medios de pago, la proporción se calcula correctamente
 *       a partir de los `amount` reales (backend-computed).
 *   (b) un `baseAmount` fabricado/inyectado en el payment NO tiene ningún
 *       efecto — el resultado es idéntico con o sin él.
 *
 * Usa la función REAL exportada por evaluator.js (no se replica).
 *
 * Ejecutar: node tests/discountEngine/payment-breakdown-proportion.test.js
 * ─────────────────────────────────────────────────────────────────
 */

const { validateTicketConditions } = require('../../services/discountEngine/universal/evaluator');

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FALLO: ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

// ═══════════════════════════════════════════════════════════════
// CASO (a): proporción correcta con 2 medios de pago, orderSubtotal
// distinto del total pagado (fuerza a usar la fórmula, no un atajo).
// ═══════════════════════════════════════════════════════════════
console.log('\n--- CASO (a): proporción calculada desde amounts reales ---');

const ticketConditions = { paymentMethods: ['CASH'] };
const rule = { allowPartial: true };
const context = {
  clientId: null,
  orderSubtotal: 800, // residual post-descuentos ITEM — distinto del total pagado
  paymentBreakdown: [
    { method: 'CASH', amount: 250 },
    { method: 'CARD', amount: 750 },
  ],
};

const result = validateTicketConditions(ticketConditions, context, rule);

// totalPagado = 1000. proporción CASH = 250/1000 = 0.25. monto = 0.25 * 800 = 200.
assert(result === true, 'Regla con medio de pago CASH presente en el breakdown pasa la condición');
assert(rule._matchingAmount === 200, `_matchingAmount = 200 (obtuvo ${rule._matchingAmount})`);

// ═══════════════════════════════════════════════════════════════
// CASO (a.2): con 3 medios de pago, solo 2 matchean paymentMethods.
// ═══════════════════════════════════════════════════════════════
console.log('\n--- CASO (a.2): 3 medios de pago, 2 matchean ---');

const ticketConditions2 = { paymentMethods: ['CASH', 'TRANSFER'] };
const rule2 = { allowPartial: true };
const context2 = {
  clientId: null,
  orderSubtotal: 1000,
  paymentBreakdown: [
    { method: 'CASH', amount: 300 },
    { method: 'TRANSFER', amount: 200 },
    { method: 'CARD', amount: 500 },
  ],
};

validateTicketConditions(ticketConditions2, context2, rule2);
// totalPagado = 1000. proporción (CASH+TRANSFER) = (300+200)/1000 = 0.5. monto = 0.5 * 1000 = 500.
assert(rule2._matchingAmount === 500, `_matchingAmount = 500 (obtuvo ${rule2._matchingAmount})`);

// ═══════════════════════════════════════════════════════════════
// CASO (b): un `baseAmount` fabricado/inyectado por el cliente es
// completamente ignorado — el resultado no cambia si se agrega o no.
// ═══════════════════════════════════════════════════════════════
console.log('\n--- CASO (b): baseAmount fabricado es ignorado ---');

const ruleWithFakeBaseAmount = { allowPartial: true };
const contextWithFakeBaseAmount = {
  clientId: null,
  orderSubtotal: 800,
  paymentBreakdown: [
    { method: 'CASH', amount: 250, baseAmount: 999999 },   // inyectado, debería ignorarse
    { method: 'CARD', amount: 750, baseAmount: 1 },        // inyectado, debería ignorarse
  ],
};

validateTicketConditions(ticketConditions, contextWithFakeBaseAmount, ruleWithFakeBaseAmount);

assert(
  ruleWithFakeBaseAmount._matchingAmount === rule._matchingAmount,
  `_matchingAmount con baseAmount fabricado (${ruleWithFakeBaseAmount._matchingAmount}) ` +
  `es idéntico al cálculo real (${rule._matchingAmount}) — baseAmount no tuvo ningún efecto`
);
assert(ruleWithFakeBaseAmount._matchingAmount === 200, 'baseAmount fabricado no altera el resultado esperado (200)');

console.log('\n========================================');
console.log('✅ TODOS LOS TESTS DE paymentBreakdown PASARON');
console.log('========================================');
