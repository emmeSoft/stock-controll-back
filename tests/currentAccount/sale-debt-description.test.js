/**
 * sale-debt-description.test.js — texto del movimiento de cuenta corriente
 * generado por una venta con deuda.
 * ─────────────────────────────────────────────────────────────────
 * Nivel 5 (tanda 4, QA cosmético): cuando una venta se manda 100% a cuenta
 * corriente (paidAmount === 0), el texto decía "Pago parcial $0 — Cargo $X",
 * lo cual es confuso — no hubo ningún pago, parcial o no.
 *
 * `buildSaleDebtDescription` es una función pura extraída de
 * `currentAccountServices.addSaleDebt` (que corre dentro de una transacción
 * Prisma) justamente para poder testear esta rama de texto sin DB.
 *
 * Ejecutar con: node tests/currentAccount/sale-debt-description.test.js
 * ─────────────────────────────────────────────────────────────────
 */

const { Prisma } = require('@prisma/client');
const { buildSaleDebtDescription } = require('../../services/currentAccountServices');

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FALLO: ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`✅ ${message}`);
  }
}

function main() {
  console.log('\n--- buildSaleDebtDescription ---');

  {
    // Venta 100% a cuenta corriente: no hubo pago en el momento.
    const text = buildSaleDebtDescription(new Prisma.Decimal(0), new Prisma.Decimal('1500.00'));
    assert(
      text === 'Venta a cuenta corriente — Cargo $1500',
      `paidAmount = 0 no menciona "pago parcial" (visto: "${text}")`
    );
    assert(!text.includes('Pago parcial'), 'no contiene la frase confusa "Pago parcial $0"');
  }

  {
    // Venta con pago parcial real + resto a cuenta corriente.
    const text = buildSaleDebtDescription(new Prisma.Decimal('500.00'), new Prisma.Decimal('1000.00'));
    assert(
      text === 'Venta — Pago parcial $500 — Cargo $1000',
      `paidAmount > 0 describe el pago parcial real (visto: "${text}")`
    );
  }

  if (process.exitCode === 1) {
    console.error('\n❌ Algunas aserciones de sale-debt-description.test.js fallaron.');
    process.exit(1);
  }
  console.log('\n✅ Todos los tests de sale-debt-description.test.js pasaron.');
}

if (require.main === module) {
  main();
}

module.exports = main;
