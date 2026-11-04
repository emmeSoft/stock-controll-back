/**
 * sale-create-invalid-payment-amount.test.js
 * ─────────────────────────────────────────────────────────────────
 * Cubre el hueco que una revisión de código encontró en la validación de
 * `paymentBreakdown[].amount` agregada en
 * `services/discountEngine/universal/evaluator.js` (ver
 * payment-breakdown-amount-validation.test.js): ese guard SOLO corría
 * dentro de `validateTicketConditions`, que `salesServices.create()` solo
 * invoca cuando hay una regla ORDER_LEVEL ACTIVA con
 * `ticketConditions.paymentMethods` seteado — el caso RARO.
 *
 * Para el caso COMÚN (una venta sin ninguna regla de descuento activa en la
 * tienda, que es la mayoría de las ventas reales), un `amount` malformado
 * (string no numérico, ausente, etc.) llegaba sin validar hasta
 * `validatePayments()` y los cálculos de `ccAmount`/`nonCCTotal` DENTRO de
 * la transacción de DB, y reventaba con un [DecimalError] crudo — sin
 * `.status`/`.code` — en vez de un 400 controlado.
 *
 * Este test llama a `salesServices.create()` directamente con CERO reglas
 * de descuento (no se crea ninguna) y un `paymentBreakdown` malformado, y
 * verifica que el error ahora es el mismo 400/INVALID_PAYMENT_AMOUNT
 * controlado — sin necesidad de fixtures de producto/caja/stock, porque la
 * validación corre ANTES de cualquier lectura a la base de datos (ver
 * salesServices.create(), justo después del chequeo de `effectiveStoreId`).
 *
 * Ejecutar con: node tests/scenarios/sale-create-invalid-payment-amount.test.js
 * ─────────────────────────────────────────────────────────────────
 */

const salesServices = require('../../services/salesServices');

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FALLO: ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`✅ ${message}`);
  }
}

async function expectInvalidAmountError(label, paymentBreakdown) {
  const saleData = {
    items: [{ id: 'fake-product-id', quantity: 1 }],
    paymentBreakdown,
    amount: 100,
  };
  const user = { id: 'fake-user-id', storeId: 'fake-store-id' };

  let thrown = null;
  try {
    await salesServices.create(saleData, user);
  } catch (err) {
    thrown = err;
  }

  assert(thrown !== null, `${label}: lanza un error en vez de reventar en Decimal math`);
  if (thrown) {
    assert(thrown.status === 400, `${label}: status === 400 (obtuvo ${thrown.status})`);
    assert(thrown.code === 'INVALID_PAYMENT_AMOUNT', `${label}: code === 'INVALID_PAYMENT_AMOUNT' (obtuvo ${thrown.code})`);
  }
}

async function main() {
  console.log('\n--- CASO 1: amount no numérico, SIN ninguna regla de descuento activa ---');
  await expectInvalidAmountError(
    "amount: 'abc'",
    [{ method: 'CASH', amount: 'abc' }]
  );

  console.log('\n--- CASO 2: amount ausente, SIN ninguna regla de descuento activa ---');
  await expectInvalidAmountError(
    'amount ausente',
    [{ method: 'CASH' }]
  );

  console.log('\n--- CASO 3: un método válido junto a uno malformado ---');
  await expectInvalidAmountError(
    "amount: 'abc' combinado con un método válido",
    [
      { method: 'CARD', amount: 50 },
      { method: 'CASH', amount: 'abc' },
    ]
  );

  if (process.exitCode === 1) {
    console.error('\n❌ Algunas aserciones de sale-create-invalid-payment-amount.test.js fallaron.');
    process.exit(1);
  }
  console.log('\n✅ Todos los tests de sale-create-invalid-payment-amount.test.js pasaron.');
}

if (require.main === module) {
  main().catch((err) => {
    console.error('❌ FALLO INESPERADO en sale-create-invalid-payment-amount.test.js:', err.message);
    process.exit(1);
  });
}

// Exported so tests/run-all.js can `await` this test (hace una llamada
// async real a salesServices.create, aunque no llegue a tocar la DB).
module.exports = main;
