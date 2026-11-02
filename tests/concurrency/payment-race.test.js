/**
 * payment-race.test.js — Concurrencia: dos pagos simultáneos sobre el mismo saldo
 * ─────────────────────────────────────────────────────────────────
 * Verifica que `currentAccountServices.registerPayment` usa un guard
 * atómico a nivel DB (`updateMany` con `WHERE balance: { gte: amount }`),
 * nunca un read-then-if: con un saldo de $1000 y dos pagos concurrentes
 * de $800 cada uno, exactamente UNO debe tener éxito y el otro debe
 * ser rechazado con status 409 — el saldo NUNCA debe quedar negativo.
 *
 * Requiere una base de datos local con RBAC seedeado (al menos un Role
 * existente) — correr `node prisma/seedRbac.js` si falla por falta de Role.
 *
 * Ejecutar con: node tests/concurrency/payment-race.test.js
 * ─────────────────────────────────────────────────────────────────
 */

const { PrismaClient } = require('@prisma/client');
const currentAccountServices = require('../../services/currentAccountServices');
const { toNumber } = require('../../utils/money');

const prisma = new PrismaClient();

// `currentAccountServices.js` requires its own `db/database.prisma` singleton
// (same module, same require-cache instance as this test's `svcPrisma`).
// `registerPayment` does two fast reads (getCurrentRegister,
// requireOpenAccount) BEFORE opening its `$transaction` with the atomic
// guard. On a very fast local Postgres, one call's entire chain (reads +
// transaction) can finish before the OTHER call's second read even
// resolves — which means the second call's *friendly pre-check* (not the
// atomic guard) rejects it with 400, never reaching the race at all. To
// force the actual race this test exists to verify (both calls' reads
// landing BEFORE either write commits, so both pre-checks pass and the
// atomic `updateMany` guard is the real decider), we need both parties to
// reach the `$transaction` entrance before either is allowed to proceed
// into the transaction body.
//
// A FIXED DELAY (e.g. "wait 80ms at the entrance") is fragile: it only
// works if BOTH calls reach the entrance within that window, which depends
// on how fast/slow the machine happens to be at that exact moment — this
// flaked ~40% of the time under load (see payment-race.test.js history).
// Instead, we use a deterministic two-party barrier: each call increments
// a shared counter upon entering `$transaction`, then awaits a shared
// Promise that resolves only once the counter reaches the expected party
// count (2, for this test). This guarantees both calls have reached the
// entrance — by construction, not by timing luck — before either proceeds.
// Restored immediately after the race, every run.
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

async function setupFixtures() {
  const role = await prisma.role.findFirst();
  if (!role) throw new Error('No hay ningún Role en la DB — correr `node prisma/seedRbac.js` primero.');

  const store = await prisma.store.create({ data: { name: '__payment_race_test_store__' } });

  const user = await prisma.user.create({
    data: {
      store:    { connect: { id: store.id } },
      email:    `payment-race-${Date.now()}@test.local`,
      password: 'x',
      firstName: 'Test',
      lastName:  'User',
      phoneNumber: '000',
      address:  'Test',
      city:     'Test',
      rbacRole: { connect: { id: role.id } },
    },
  });

  const client = await prisma.client.create({
    data: {
      store:   { connect: { id: store.id } },
      email:   'cliente-payment-race@test.local',
      firstName: 'Cliente',
      lastName:  'DeudorTest',
      dni:     '00000000',
      phoneNumber: '000',
      address: 'Test',
      city:    'Test',
    },
  });

  const account = await prisma.currentAccount.create({
    data: {
      client: { connect: { id: client.id } },
      store:  { connect: { id: store.id } },
      balance: 1000,
      status:  'OPEN',
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

  return { store, user, client, account, cashRegister };
}

async function cleanup({ store, user, client, account, cashRegister }) {
  await prisma.currentAccountMovement.deleteMany({ where: { currentAccountId: account.id } }).catch(() => {});
  await prisma.cashMovement.deleteMany({ where: { cashRegisterId: cashRegister.id } }).catch(() => {});
  await prisma.currentAccount.delete({ where: { id: account.id } }).catch(() => {});
  await prisma.cashRegister.delete({ where: { id: cashRegister.id } }).catch(() => {});
  await prisma.client.delete({ where: { id: client.id } }).catch(() => {});
  await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
  await prisma.store.delete({ where: { id: store.id } }).catch(() => {});
}

async function main() {
  const fixtures = await setupFixtures();
  const { store, user, client, account } = fixtures;

  try {
    console.log('\n--- CASO 1: dos pagos concurrentes de $800 sobre un saldo de $1000 ---');

    const authUser = { id: user.id, storeId: store.id, isSistema: false };

    patchTransactionBarrier(2);
    let results;
    try {
      results = await Promise.allSettled([
        currentAccountServices.registerPayment({ clientId: client.id, amount: 800, paymentMethod: 'Efectivo' }, authUser),
        currentAccountServices.registerPayment({ clientId: client.id, amount: 800, paymentMethod: 'Efectivo' }, authUser),
      ]);
    } finally {
      restoreTransaction();
    }

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    assert(fulfilled.length === 1, 'exactamente un pago tuvo éxito');
    assert(rejected.length === 1, 'exactamente un pago fue rechazado');
    assert(rejected[0]?.reason?.status === 409, 'el pago rechazado lanza status 409 (el saldo cambió, no un 400 ni un éxito silencioso)');

    const finalAccount = await prisma.currentAccount.findUnique({ where: { id: account.id } });
    assert(toNumber(finalAccount.balance) === 200, `el saldo final es exactamente $200 (visto: $${toNumber(finalAccount.balance)})`);
    assert(toNumber(finalAccount.balance) >= 0, 'el saldo NUNCA queda negativo');

    const movements = await prisma.currentAccountMovement.findMany({
      where: { currentAccountId: account.id, type: 'PAYMENT' },
    });
    assert(movements.length === 1, 'se creó exactamente un CurrentAccountMovement de tipo PAYMENT (no uno por cada intento)');

    const cashMovements = await prisma.cashMovement.findMany({ where: { reference: `CC-${account.id}` } });
    assert(cashMovements.length === 1, 'se creó exactamente un CashMovement de tipo INCOME (no uno por cada intento)');
  } finally {
    await cleanup(fixtures);
    await prisma.$disconnect();
  }

  if (process.exitCode === 1) {
    console.error('\n❌ Algunas aserciones de payment-race.test.js fallaron.');
    process.exit(1);
  }
  console.log('\n✅ Todos los tests de payment-race.test.js pasaron.');
}

if (require.main === module) {
  main().catch(async (err) => {
    console.error('❌ FALLO INESPERADO en payment-race.test.js:', err.message);
    await prisma.$disconnect().catch(() => {});
    process.exit(1);
  });
}

// Exported so tests/run-all.js can `await` this test instead of relying on
// require()'s synchronous side effects (this test does real async I/O).
module.exports = main;
