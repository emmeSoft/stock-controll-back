/**
 * payment-breakdown-amount-validation.test.js
 * ─────────────────────────────────────────────────────────────────
 * Cubre la validación numérica de `paymentBreakdown[].amount` agregada en
 * `validateTicketConditions` (services/discountEngine/universal/evaluator.js),
 * rama proporcional (con `context.paymentBreakdown` no vacío).
 *
 * Antes de este fix, un `amount` inválido (string no numérico, ausente, cero,
 * negativo, NaN, Infinity) llegaba sin validar a `money()`/`sum()` — en la
 * venta real (salesServices.create) esto revienta DENTRO de la transacción
 * de DB, antes de que `validatePayments` (que corre después del motor) tenga
 * chance de validar la forma del payload; en discountService.preview() no
 * había ninguna red de contención.
 *
 * Verifica que ahora se lanza un error controlado:
 *   - status: 400 (payload malformado, no conflicto)
 *   - code: 'INVALID_PAYMENT_AMOUNT'
 * para cada forma de amount inválido, y que el caso válido sigue funcionando
 * (no regresión sobre payment-breakdown-proportion.test.js).
 *
 * Ejecutar: node tests/discountEngine/payment-breakdown-amount-validation.test.js
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

function expectInvalidAmountError(label, paymentBreakdown) {
  const ticketConditions = { paymentMethods: ['CASH'] };
  const rule = { allowPartial: true };
  const context = {
    clientId: null,
    orderSubtotal: 800,
    paymentBreakdown,
  };

  let thrown = null;
  try {
    validateTicketConditions(ticketConditions, context, rule);
  } catch (err) {
    thrown = err;
  }

  assert(thrown !== null, `${label}: lanza un error en vez de reventar en Decimal math`);
  if (thrown) {
    assert(thrown.status === 400, `${label}: status === 400 (obtuvo ${thrown.status})`);
    assert(thrown.code === 'INVALID_PAYMENT_AMOUNT', `${label}: code === 'INVALID_PAYMENT_AMOUNT' (obtuvo ${thrown.code})`);
  }
}

// ═══════════════════════════════════════════════════════════════
// CASO 1: amount no numérico ('abc')
// ═══════════════════════════════════════════════════════════════
console.log('\n--- CASO 1: amount no numérico ---');
expectInvalidAmountError(
  "amount: 'abc'",
  [
    { method: 'CASH', amount: 'abc' },
    { method: 'CARD', amount: 750 },
  ]
);

// ═══════════════════════════════════════════════════════════════
// CASO 2: amount ausente
// ═══════════════════════════════════════════════════════════════
console.log('\n--- CASO 2: amount ausente ---');
expectInvalidAmountError(
  'amount ausente',
  [
    { method: 'CASH' },
    { method: 'CARD', amount: 750 },
  ]
);

// ═══════════════════════════════════════════════════════════════
// CASO 3: amount cero
// ═══════════════════════════════════════════════════════════════
console.log('\n--- CASO 3: amount cero ---');
expectInvalidAmountError(
  'amount: 0',
  [
    { method: 'CASH', amount: 0 },
    { method: 'CARD', amount: 750 },
  ]
);

// ═══════════════════════════════════════════════════════════════
// CASO 4: amount negativo
// ═══════════════════════════════════════════════════════════════
console.log('\n--- CASO 4: amount negativo ---');
expectInvalidAmountError(
  'amount: -100',
  [
    { method: 'CASH', amount: -100 },
    { method: 'CARD', amount: 750 },
  ]
);

// ═══════════════════════════════════════════════════════════════
// CASO 5: amount Infinity
// ═══════════════════════════════════════════════════════════════
console.log('\n--- CASO 5: amount Infinity ---');
expectInvalidAmountError(
  'amount: Infinity',
  [
    { method: 'CASH', amount: Infinity },
    { method: 'CARD', amount: 750 },
  ]
);

// ═══════════════════════════════════════════════════════════════
// CASO 6: no-regresión — breakdown válido sigue calculando normalmente
// ═══════════════════════════════════════════════════════════════
console.log('\n--- CASO 6: breakdown válido no se ve afectado ---');
const ticketConditions = { paymentMethods: ['CASH'] };
const rule = { allowPartial: true };
const context = {
  clientId: null,
  orderSubtotal: 800,
  paymentBreakdown: [
    { method: 'CASH', amount: 250 },
    { method: 'CARD', amount: 750 },
  ],
};
const result = validateTicketConditions(ticketConditions, context, rule);
assert(result === true, 'breakdown válido: la condición sigue pasando');
assert(rule._matchingAmount === 200, `breakdown válido: _matchingAmount = 200 (obtuvo ${rule._matchingAmount})`);

console.log('\n========================================');
console.log('✅ TODOS LOS TESTS DE VALIDACIÓN DE paymentBreakdown.amount PASARON');
console.log('========================================');
