/**
 * validate-payments-fixed-tolerance.test.js
 * ─────────────────────────────────────────────────────────────────
 * Cubre el cambio de tolerancia en `validatePayments` (services/salesServices.js):
 * antes era dinámica (`max($0.01, 0.1% del total)`), lo que en una venta de
 * $120.000 aceptaba hasta $120 de diferencia. Ahora es fija en $0.05 —
 * independiente del monto de la venta.
 *
 * No usa la base de datos (validatePayments es una función pura).
 *
 * Ejecutar: node tests/scenarios/validate-payments-fixed-tolerance.test.js
 * ─────────────────────────────────────────────────────────────────
 */

const { validatePayments } = require('../../services/salesServices');

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FALLO: ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

function throws(fn, message) {
  try {
    fn();
    console.error(`❌ FALLO: ${message} (no lanzó)`);
    process.exit(1);
  } catch (e) {
    console.log(`✅ ${message}`);
  }
}

console.log('\n--- CASO: diferencia de exactamente $0.05 se tolera ---');
assert(
  (() => { validatePayments([{ method: 'EFECTIVO', amount: 99.95 }], 100); return true; })(),
  'Venta de $100, pagado $99.95 (diff $0.05): no lanza'
);

console.log('\n--- CASO: diferencia de $0.06 NO se tolera ---');
throws(
  () => validatePayments([{ method: 'EFECTIVO', amount: 99.94 }], 100),
  'Venta de $100, pagado $99.94 (diff $0.06): lanza error de pago insuficiente'
);

console.log('\n--- CASO CLAVE: en una venta grande, la tolerancia sigue siendo $0.05, no escala ---');
throws(
  () => validatePayments([{ method: 'EFECTIVO', amount: 119940 }], 120000),
  'Venta de $120.000, pagado $119.940 (diff $60): lanza error — antes la tolerancia dinámica (0.1%) habría aceptado hasta $120 de diferencia'
);
assert(
  (() => { validatePayments([{ method: 'EFECTIVO', amount: 119999.95 }], 120000); return true; })(),
  'Venta de $120.000, pagado $119.999,95 (diff $0.05): no lanza — misma tolerancia fija que en una venta chica'
);

console.log('\n--- CASO: pago exacto siempre pasa ---');
assert(
  (() => { validatePayments([{ method: 'EFECTIVO', amount: 100 }], 100); return true; })(),
  'Pago exacto: no lanza'
);

console.log('\n--- CASO: pagar de más siempre se acepta (SC-3.4, se asume vuelto) ---');
assert(
  (() => { validatePayments([{ method: 'EFECTIVO', amount: 150 }], 100); return true; })(),
  'Venta de $100, pagado $150: no lanza (excedente se asume vuelto/contable)'
);

console.log('\n========================================');
console.log('✅ TODOS LOS TESTS DE validatePayments (tolerancia fija) PASARON');
console.log('========================================');
