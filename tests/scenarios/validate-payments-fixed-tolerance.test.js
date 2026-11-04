/**
 * validate-payments-fixed-tolerance.test.js
 * ─────────────────────────────────────────────────────────────────
 * Cubre `paymentTolerance`/`validatePayments` (services/salesServices.js):
 * la tolerancia sigue siendo `max($0.01, 0.1% del monto)` — sin cambios en
 * el piso ni en el crecimiento proporcional — pero ahora tiene un TECHO de
 * $0.05. Antes crecía sin límite (una venta de $120.000 toleraba hasta $120
 * de diferencia); ahora nunca supera $0.05 sin importar el monto.
 *
 * Primer intento de este fix (ya corregido) reemplazaba la fórmula entera
 * por un valor fijo de $0.05, lo que rompía ventas CHICAS: para un total
 * ≤ $0.05 el chequeo quedaba vacío (aceptaba pagar casi nada). De ahí los
 * casos "venta chica" abajo — son regresión-guards de ese bug encontrado
 * en code review antes de pushear.
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

function doesNotThrow(fn, message) {
  fn();
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

console.log('\n--- CASO: venta mediana (tolerancia = 0.1% del total, sin tocar el techo) ---');
doesNotThrow(
  () => validatePayments([{ method: 'EFECTIVO', amount: 99.95 }], 100),
  'Venta de $100, pagado $99.95 (diff $0.05 = 0.1% de 100): no lanza'
);
throws(
  () => validatePayments([{ method: 'EFECTIVO', amount: 99.94 }], 100),
  'Venta de $100, pagado $99.94 (diff $0.06 > tolerancia $0.05): lanza'
);

console.log('\n--- CASO CLAVE: venta grande, la tolerancia queda topeada en $0.05 ---');
throws(
  () => validatePayments([{ method: 'EFECTIVO', amount: 119940 }], 120000),
  'Venta de $120.000, pagado $119.940 (diff $60): lanza — antes (sin techo) el 0.1% habría tolerado hasta $120'
);
doesNotThrow(
  () => validatePayments([{ method: 'EFECTIVO', amount: 119999.95 }], 120000),
  'Venta de $120.000, pagado $119.999,95 (diff $0.05, en el techo): no lanza'
);

console.log('\n--- CASO CLAVE: venta chica, el piso de $0.01 sigue vigente (no el techo de $0.05) ---');
throws(
  () => validatePayments([{ method: 'EFECTIVO', amount: 0.01 }], 0.05),
  'Venta de $0.05, pagado $0.01 (diff $0.04 > tolerancia real $0.01): lanza — ' +
  'el bug corregido habría usado tolerancia $0.05 y dejado pasar esto'
);
doesNotThrow(
  () => validatePayments([{ method: 'EFECTIVO', amount: 0.04 }], 0.05),
  'Venta de $0.05, pagado $0.04 (diff $0.01 = piso): no lanza'
);

console.log('\n--- CASO: pago exacto y sobrepago siempre pasan ---');
doesNotThrow(
  () => validatePayments([{ method: 'EFECTIVO', amount: 100 }], 100),
  'Pago exacto: no lanza'
);
doesNotThrow(
  () => validatePayments([{ method: 'EFECTIVO', amount: 150 }], 100),
  'Venta de $100, pagado $150: no lanza (excedente se asume vuelto/contable, SC-3.4)'
);

console.log('\n========================================');
console.log('✅ TODOS LOS TESTS DE validatePayments (tolerancia con techo) PASARON');
console.log('========================================');
