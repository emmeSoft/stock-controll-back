/**
 * cash-movement-vs-caja-close-race.test.js — Concurrencia: movimiento manual
 * y pago de cuenta corriente en efectivo vs. un cierre de caja
 * ─────────────────────────────────────────────────────────────────
 * Misma invariante de `Register-Bound Operation Consistency` que
 * `sale-vs-caja-close-race.test.js`, aplicada a los otros dos binders que
 * escriben contra una caja: `movimientosServices.createMovement` y
 * `currentAccountServices.registerPayment` (pago en efectivo de cuenta
 * corriente — SIEMPRE genera un `CashMovement` de tipo INCOME en la caja
 * activa). Ambos casos escriben un `CashMovement`, por eso comparten este
 * archivo en vez de uno con un nombre que mienta sobre su contenido
 * (design.md Open Question 4).
 *
 *   CASO 1 — `createMovement` ‖ cierre.
 *   CASO 2 — `registerPayment` (pago CC en efectivo) ‖ cierre.
 *
 * En ambos casos: el cierre SIEMPRE tiene éxito (nada más le disputa el
 * lock de cierre en esta carrera); el binder gana o pierde. Si gana, su
 * monto queda contado en el `expectedAmount` del cierre. Si pierde, es
 * rechazado con status 409 / code CASH_REGISTER_CLOSED y NO deja rastro
 * (ningún CashMovement / CurrentAccountMovement creado, ningún saldo
 * modificado).
 *
 * Mismo two-party barrier que `payment-race.test.js` — determinístico por
 * construcción, sin fixed-delays (design.md Decisión 8).
 *
 * Requiere una base de datos local con RBAC seedeado.
 *
 * Ejecutar con: node tests/concurrency/cash-movement-vs-caja-close-race.test.js
 * ─────────────────────────────────────────────────────────────────
 */

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const movimientosServices = require('../../services/movimientosServices');
const currentAccountServices = require('../../services/currentAccountServices');
const cajaServices = require('../../services/cajaServices');
const { toNumber } = require('../../utils/money');

const prisma = new PrismaClient();

const TEST_PASSWORD = 'cash-movement-vs-close-race-test-pw';

const svcPrisma = require('../../db/database.prisma');
const originalTransaction = svcPrisma.$transaction.bind(svcPrisma);
function patchTransactionBarrier(partyCount) {
  let arrived = 0;
  let releaseBarrier;
  const barrier = new Promise((resolve) => { releaseBarrier = resolve; });
  svcPrisma.$transaction = (fnOrArray, opts) => {
    if (typeof fnOrArray === 'function') {
      return originalTransaction(async (tx) => {
        arrived += 1;
        if (arrived >= partyCount) releaseBarrier();
        await barrier;
        return fnOrArray(tx);
      }, opts);
    }
    return originalTransaction(fnOrArray, opts);
  };
}
function restoreTransaction() {
  svcPrisma.$transaction = originalTransaction;
}

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FALLO: ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`✅ ${message}`);
  }
}

async function makeBaseFixtures(label) {
  const role = await prisma.role.findFirst();
  if (!role) throw new Error('No hay ningún Role en la DB — correr `node prisma/seedRbac.js` primero.');

  const store = await prisma.store.create({ data: { name: `__cash_mov_vs_close_${label}_test_store__` } });

  const hashedPassword = await bcrypt.hash(TEST_PASSWORD, 10);
  const user = await prisma.user.create({
    data: {
      store:    { connect: { id: store.id } },
      email:    `cash-mov-vs-close-${label}-${Date.now()}@test.local`,
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
      openingAmount: 0,
      status:        'OPEN',
    },
  });

  return { store, user, cashRegister };
}

async function cleanupBaseFixtures({ store, user, cashRegister }) {
  await prisma.cashMovement.deleteMany({ where: { cashRegisterId: cashRegister.id } }).catch(() => {});
  await prisma.cashRegister.deleteMany({ where: { id: cashRegister.id } }).catch(() => {});
  await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
  await prisma.store.delete({ where: { id: store.id } }).catch(() => {});
}

async function main() {
  try {
    console.log('\n--- CASO 1: createMovement ‖ cierre ---');
    {
      const fixtures = await makeBaseFixtures('caso1');
      const { store, user, cashRegister } = fixtures;

      try {
        const authUser = { id: user.id, storeId: store.id, isSimulating: false };

        patchTransactionBarrier(2);
        let results;
        try {
          results = await Promise.allSettled([
            movimientosServices.createMovement({ type: 'INCOME', amount: 150, description: 'ingreso en carrera' }, authUser),
            cajaServices.closeRegister({ closingAmount: 0, password: TEST_PASSWORD }, authUser),
          ]);
        } finally {
          restoreTransaction();
        }

        const [movementResult, closeResult] = results;

        assert(closeResult.status === 'fulfilled', 'el cierre SIEMPRE tiene éxito en esta carrera');

        if (movementResult.status === 'fulfilled') {
          console.log('   (el movimiento ganó la carrera)');
          const movements = await prisma.cashMovement.findMany({ where: { cashRegisterId: cashRegister.id } });
          assert(movements.length === 1, 'exactamente un CashMovement fue creado');

          if (closeResult.status === 'fulfilled') {
            assert(
              toNumber(closeResult.value.expectedAmount) === 150,
              `expectedAmount del cierre incluye el movimiento ganador (visto: ${toNumber(closeResult.value.expectedAmount)})`
            );
          }
        } else {
          console.log('   (el movimiento perdió la carrera)');
          assert(movementResult.reason?.status === 409, `el movimiento rechazado lanza status 409 (visto: ${movementResult.reason?.status})`);
          assert(
            movementResult.reason?.code === 'CASH_REGISTER_CLOSED',
            `el movimiento rechazado lleva code CASH_REGISTER_CLOSED (visto: ${movementResult.reason?.code})`
          );

          const movements = await prisma.cashMovement.findMany({ where: { cashRegisterId: cashRegister.id } });
          assert(movements.length === 0, 'CERO CashMovement — el movimiento rechazado no dejó rastro');

          if (closeResult.status === 'fulfilled') {
            assert(toNumber(closeResult.value.expectedAmount) === 0, 'expectedAmount del cierre NO incluye el movimiento rechazado');
          }
        }
      } finally {
        await cleanupBaseFixtures(fixtures);
      }
    }

    console.log('\n--- CASO 2: registerPayment (pago CC en efectivo) ‖ cierre ---');
    {
      const fixtures = await makeBaseFixtures('caso2');
      const { store, user, cashRegister } = fixtures;

      const client = await prisma.client.create({
        data: {
          store:   { connect: { id: store.id } },
          email:   `cliente-cash-mov-vs-close-${Date.now()}@test.local`,
          firstName: 'Cliente',
          lastName:  'CashMovVsCloseTest',
          dni:     '00000002',
          phoneNumber: '000',
          address: 'Test',
          city:    'Test',
        },
      });

      const account = await prisma.currentAccount.create({
        data: {
          client: { connect: { id: client.id } },
          store:  { connect: { id: store.id } },
          balance: 500,
          status:  'OPEN',
        },
      });

      try {
        const authUser = { id: user.id, storeId: store.id, isSimulating: false };

        patchTransactionBarrier(2);
        let results;
        try {
          results = await Promise.allSettled([
            currentAccountServices.registerPayment({ clientId: client.id, amount: 200, paymentMethod: 'Efectivo' }, authUser),
            cajaServices.closeRegister({ closingAmount: 0, password: TEST_PASSWORD }, authUser),
          ]);
        } finally {
          restoreTransaction();
        }

        const [paymentResult, closeResult] = results;

        assert(closeResult.status === 'fulfilled', 'el cierre SIEMPRE tiene éxito en esta carrera');

        if (paymentResult.status === 'fulfilled') {
          console.log('   (el pago CC ganó la carrera)');
          const finalAccount = await prisma.currentAccount.findUnique({ where: { id: account.id } });
          assert(toNumber(finalAccount.balance) === 300, 'el saldo de la cuenta corriente se decrementó en 200');

          const cashMovements = await prisma.cashMovement.findMany({ where: { cashRegisterId: cashRegister.id, reference: `CC-${account.id}` } });
          assert(cashMovements.length === 1, 'exactamente un CashMovement de tipo INCOME fue creado para el pago');

          if (closeResult.status === 'fulfilled') {
            assert(
              toNumber(closeResult.value.expectedAmount) === 200,
              `expectedAmount del cierre incluye el pago CC ganador (visto: ${toNumber(closeResult.value.expectedAmount)})`
            );
          }
        } else {
          console.log('   (el pago CC perdió la carrera)');
          assert(paymentResult.reason?.status === 409, `el pago rechazado lanza status 409 (visto: ${paymentResult.reason?.status})`);
          assert(
            paymentResult.reason?.code === 'CASH_REGISTER_CLOSED',
            `el pago rechazado lleva code CASH_REGISTER_CLOSED (visto: ${paymentResult.reason?.code})`
          );

          const finalAccount = await prisma.currentAccount.findUnique({ where: { id: account.id } });
          assert(toNumber(finalAccount.balance) === 500, 'el saldo de la cuenta corriente NO cambió');

          const cashMovements = await prisma.cashMovement.findMany({ where: { cashRegisterId: cashRegister.id, reference: `CC-${account.id}` } });
          assert(cashMovements.length === 0, 'ningún CashMovement fue creado para el pago rechazado');

          const ccMovements = await prisma.currentAccountMovement.findMany({ where: { currentAccountId: account.id } });
          assert(ccMovements.length === 0, 'ningún CurrentAccountMovement fue creado para el pago rechazado');

          if (closeResult.status === 'fulfilled') {
            assert(toNumber(closeResult.value.expectedAmount) === 0, 'expectedAmount del cierre NO incluye el pago rechazado');
          }
        }
      } finally {
        await prisma.currentAccountMovement.deleteMany({ where: { currentAccountId: account.id } }).catch(() => {});
        await prisma.currentAccount.delete({ where: { id: account.id } }).catch(() => {});
        await prisma.client.delete({ where: { id: client.id } }).catch(() => {});
        await cleanupBaseFixtures(fixtures);
      }
    }
  } finally {
    await prisma.$disconnect();
  }

  if (process.exitCode === 1) {
    console.error('\n❌ Algunas aserciones de cash-movement-vs-caja-close-race.test.js fallaron.');
    process.exit(1);
  }
  console.log('\n✅ Todos los tests de cash-movement-vs-caja-close-race.test.js pasaron.');
}

if (require.main === module) {
  main().catch(async (err) => {
    console.error('❌ FALLO INESPERADO en cash-movement-vs-caja-close-race.test.js:', err.message);
    await prisma.$disconnect().catch(() => {});
    process.exit(1);
  });
}

// Exported so tests/run-all.js can `await` this test instead of relying on
// require()'s synchronous side effects (this test does real async I/O).
module.exports = main;
