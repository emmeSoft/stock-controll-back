/**
 * movement-validation.test.js — Escenario: validación de monto en createMovement
 * y aritmética Decimal en el cierre de caja
 * ─────────────────────────────────────────────────────────────────
 * Traza money-precision "Movement Amount Validation" (ambos escenarios) y
 * "Decimal Arithmetic and Rounding" vía cajaServices.closeRegister.
 *
 *   CASO 1: `createMovement` rechaza amount negativo, cero, NaN y no-numérico.
 *   Ningún `CashMovement` se crea para ninguno de los cuatro casos.
 *
 *   CASO 2: `createMovement` acepta un amount positivo válido (150.00) y
 *   crea el movimiento.
 *
 *   CASO 3: dos movimientos más (1234.56 INCOME, 789.12 EXPENSE) sobre una
 *   caja con apertura de 1000.00 producen un `expectedAmount` exacto al
 *   cerrar (1000 + 1234.56 - 789.12 = 1445.44), sin arrastre de punto
 *   flotante — verifica que `cajaServices.closeRegister` usa aritmética
 *   Decimal (`utils/money.js`), no `+`/`-` nativos sobre Decimal.
 *
 * Ejecutar con: node tests/scenarios/movement-validation.test.js
 * ─────────────────────────────────────────────────────────────────
 */

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const movimientosServices = require('../../services/movimientosServices');
const cajaServices = require('../../services/cajaServices');
const { toNumber } = require('../../utils/money');

const prisma = new PrismaClient();

const TEST_PASSWORD = 'movement-validation-test-pw';

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FALLO: ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`✅ ${message}`);
  }
}

async function setupFixtures() {
  const role = await prisma.role.findFirst();
  if (!role) throw new Error('No hay ningún Role en la DB — correr `node prisma/seedRbac.js` primero.');

  const store = await prisma.store.create({ data: { name: '__movement_validation_test_store__' } });

  const hashedPassword = await bcrypt.hash(TEST_PASSWORD, 10);
  const user = await prisma.user.create({
    data: {
      store:    { connect: { id: store.id } },
      email:    `movement-validation-${Date.now()}@test.local`,
      password: hashedPassword,
      firstName: 'Test',
      lastName:  'User',
      phoneNumber: '000',
      address:  'Test',
      city:     'Test',
      rbacRole: { connect: { id: role.id } },
    },
  });

  const cashRegister = await prisma.cashRegister.create({
    data: {
      store:        { connect: { id: store.id } },
      openedByUser: { connect: { id: user.id } },
      openingAmount: 1000.00,
      status:        'OPEN',
    },
  });

  return { store, user, cashRegister };
}

async function cleanup({ store, user, cashRegister }) {
  await prisma.cashMovement.deleteMany({ where: { cashRegisterId: cashRegister.id } }).catch(() => {});
  await prisma.cashRegister.deleteMany({ where: { id: cashRegister.id } }).catch(() => {});
  await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
  await prisma.store.delete({ where: { id: store.id } }).catch(() => {});
}

async function main() {
  const fixtures = await setupFixtures();
  const { store, user, cashRegister } = fixtures;
  const authUser = { id: user.id, storeId: store.id, isSimulating: false };

  try {
    console.log('\n--- CASO 1: createMovement rechaza amount negativo, cero, NaN y no-numérico ---');

    const invalidAmounts = [
      { amount: -1, label: '-1' },
      { amount: 0, label: '0' },
      { amount: NaN, label: 'NaN' },
      { amount: 'abc', label: '"abc"' },
    ];
    for (const { amount, label } of invalidAmounts) {
      let rejected = false;
      let rejectedWithStatus400 = false;
      try {
        await movimientosServices.createMovement(
          { type: 'INCOME', amount, description: 'intento inválido' },
          authUser
        );
      } catch (error) {
        rejected = true;
        rejectedWithStatus400 = error.status === 400;
      }
      assert(rejected, `createMovement rechaza amount=${label}`);
      assert(rejectedWithStatus400, `createMovement rechaza amount=${label} con status 400`);
    }

    const movementsAfterInvalid = await prisma.cashMovement.findMany({
      where: { cashRegisterId: cashRegister.id },
    });
    assert(movementsAfterInvalid.length === 0, 'ningún CashMovement fue creado para los 4 montos inválidos');

    console.log('\n--- CASO 2: createMovement acepta un amount positivo válido ---');

    const validMovement = await movimientosServices.createMovement(
      { type: 'INCOME', amount: 150.00, description: 'ingreso válido' },
      authUser
    );

    assert(!!validMovement.id, 'createMovement crea el movimiento cuando amount es positivo y finito (150.00)');
    assert(toNumber(validMovement.amount) === 150.00, 'el monto persistido es exactamente 150.00');

    console.log('\n--- CASO 3: expectedAmount en el cierre usa aritmética Decimal exacta ---');

    // Revertimos el movimiento de CASO 2 para dejar un escenario limpio y
    // predecible para el cálculo de expectedAmount de este caso.
    await prisma.cashMovement.deleteMany({ where: { cashRegisterId: cashRegister.id } });

    await movimientosServices.createMovement(
      { type: 'INCOME', amount: 1234.56, description: 'ingreso manual' },
      authUser
    );
    await movimientosServices.createMovement(
      { type: 'EXPENSE', amount: 789.12, description: 'retiro manual' },
      authUser
    );

    const closed = await cajaServices.closeRegister(
      { closingAmount: 1445.44, password: TEST_PASSWORD },
      authUser
    );

    assert(
      toNumber(closed.expectedAmount) === 1445.44,
      `expectedAmount es exactamente 1445.44 (1000 + 1234.56 - 789.12), sin arrastre de punto flotante (visto: ${toNumber(closed.expectedAmount)})`
    );
    assert(
      toNumber(closed.difference) === 0,
      `difference es exactamente 0 cuando closingAmount coincide con expectedAmount (visto: ${toNumber(closed.difference)})`
    );
  } finally {
    await cleanup({ store, user, cashRegister });
    await prisma.$disconnect();
  }

  if (process.exitCode === 1) {
    console.error('\n❌ Algunas aserciones de movement-validation.test.js fallaron.');
    process.exit(1);
  }
  console.log('\n✅ Todos los tests de movement-validation.test.js pasaron.');
}

if (require.main === module) {
  main().catch(async (err) => {
    console.error('❌ FALLO INESPERADO en movement-validation.test.js:', err.message);
    await prisma.$disconnect().catch(() => {});
    process.exit(1);
  });
}

// Exportado para que tests/run-all.js pueda `await` este test (hace I/O async real).
module.exports = main;
