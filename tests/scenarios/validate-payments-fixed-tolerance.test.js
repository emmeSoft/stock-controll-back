/**
 * validate-payments-fixed-tolerance.test.js
 * ─────────────────────────────────────────────────────────────────
 * Cubre `paymentTolerance`/`validatePayments` (services/salesServices.js):
 * la tolerancia sigue siendo `max($0.01, 0.1% del monto)` — sin cambios en
 * el piso ni en el crecimiento proporcional — pero ahora tiene un TECHO de
 * $0.50. Antes crecía sin límite (una venta de $120.000 toleraba hasta $120
 * de diferencia); ahora nunca supera $0.50 sin importar el monto.
 *
 * ¿Por qué $0.50 y no algo más chico? `discountService.mergeEngineResults`
 * (llamado desde el mismo flujo de `create()`) todavía hace su aritmética de
 * cascada con `number` nativo, redondeando a centavos en CADA paso (vía
 * `toNumber()`, que siempre redondea — ver utils/money.js). En un carrito
 * grande con muchas líneas/reglas en cascada, ese arrastre legítimo de
 * redondeo puede superar unos pocos centavos — un techo muy chico (se probó
 * $0.05 primero) arriesgaba rechazar ventas correctas. $0.50 es el propio
 * ejemplo que cita el comentario original de este archivo para ese
 * escenario.
 *
 * No usa la base de datos (validatePayments es una función pura).
 *
 * Ejecutar: node tests/scenarios/validate-payments-fixed-tolerance.test.js
 * ─────────────────────────────────────────────────────────────────
 */

const { validatePayments } = require('../../services/salesServices');

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

console.log('\n--- CASO: venta de $100 — tolerancia proporcional (0.1% = $0.10), todavía no toca el techo ---');
doesNotThrow(
  () => validatePayments([{ method: 'EFECTIVO', amount: 99.90 }], 100),
  'Venta de $100, pagado $99.90 (diff $0.10 = 0.1% de 100): no lanza'
);
throws(
  () => validatePayments([{ method: 'EFECTIVO', amount: 99.89 }], 100),
  'Venta de $100, pagado $99.89 (diff $0.11 > tolerancia $0.10): lanza'
);

console.log('\n--- CASO CLAVE: venta grande, la tolerancia queda topeada en $0.50 ---');
throws(
  () => validatePayments([{ method: 'EFECTIVO', amount: 119940 }], 120000),
  'Venta de $120.000, pagado $119.940 (diff $60): lanza — antes (sin techo) el 0.1% habría tolerado hasta $120'
);
doesNotThrow(
  () => validatePayments([{ method: 'EFECTIVO', amount: 119999.50 }], 120000),
  'Venta de $120.000, pagado $119.999,50 (diff $0.50, en el techo): no lanza'
);
throws(
  () => validatePayments([{ method: 'EFECTIVO', amount: 119999.49 }], 120000),
  'Venta de $120.000, pagado $119.999,49 (diff $0.51 > techo $0.50): lanza'
);

console.log('\n--- CASO CLAVE: venta chica, el piso de $0.01 sigue vigente (no el techo de $0.50) ---');
throws(
  () => validatePayments([{ method: 'EFECTIVO', amount: 0.01 }], 0.05),
  'Venta de $0.05, pagado $0.01 (diff $0.04 > tolerancia real $0.01): lanza — ' +
  'un techo aplicado como valor fijo habría usado $0.50 y dejado pasar esto'
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
