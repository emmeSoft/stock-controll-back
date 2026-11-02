/**
 * close-race.test.js — Concurrencia: cierre de cuenta vs. un cargo llegando al mismo tiempo
 * ─────────────────────────────────────────────────────────────────
 * Verifica que `currentAccountServices.close` usa un guard atómico a
 * nivel DB (`updateMany` con `WHERE status: 'OPEN', balance: 0`),
 * nunca un read-then-if: con una cuenta en saldo $0 y una escritura
 * concurrente que mueve el saldo lejos de 0 (simulando un cargo /
 * venta a crédito llegando al mismo tiempo, igual que lo haría
 * `addSaleDebt` dentro de la tx real de una venta), a lo sumo UNA de
 * las dos operaciones debe tener éxito. Si el cargo gana la carrera,
 * el cierre debe ser rechazado con 409 — NUNCA debe quedar una cuenta
 * CLOSED con saldo distinto de 0.
 *
 * "No fix these as flaky": bajo READ COMMITTED, el segundo UPDATE que
 * toca la misma fila bloquea hasta que el primero commitea, y luego
 * reevalúa su WHERE contra el valor ya commiteado. El resultado (una
 * operación gana, la otra es rechazada) es determinístico aunque el
 * entrelazado de Promesas de JS no lo sea — ver design.md.
 *
 * Ejecutar con: node tests/concurrency/close-race.test.js
 * ─────────────────────────────────────────────────────────────────
 */

const { PrismaClient } = require('@prisma/client');
const currentAccountServices = require('../../services/currentAccountServices');
const { toNumber } = require('../../utils/money');

const prisma = new PrismaClient();

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

  const store = await prisma.store.create({ data: { name: '__close_race_test_store__' } });

  const user = await prisma.user.create({
    data: {
      store:    { connect: { id: store.id } },
      email:    `close-race-${Date.now()}@test.local`,
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
      email:   'cliente-close-race@test.local',
      firstName: 'Cliente',
      lastName:  'CierreTest',
      dni:     '00000001',
      phoneNumber: '000',
      address: 'Test',
      city:    'Test',
    },
  });

  const account = await prisma.currentAccount.create({
    data: {
      client: { connect: { id: client.id } },
      store:  { connect: { id: store.id } },
      balance: 0,
      status:  'OPEN',
    },
  });

  return { store, user, client, account };
}

async function cleanup({ store, user, client, account }) {
  await prisma.currentAccountMovement.deleteMany({ where: { currentAccountId: account.id } }).catch(() => {});
  await prisma.currentAccount.delete({ where: { id: account.id } }).catch(() => {});
  await prisma.client.delete({ where: { id: client.id } }).catch(() => {});
  await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
  await prisma.store.delete({ where: { id: store.id } }).catch(() => {});
}

// Simula una escritura concurrente que agrega un cargo (p.ej. el equivalente
// a `addSaleDebt` dentro de la tx de una venta a crédito) a la cuenta —
// atómica y guardada por `status: 'OPEN'`, igual que el guard real.
async function simulateConcurrentCharge(accountId) {
  const { count } = await prisma.currentAccount.updateMany({
    where: { id: accountId, status: 'OPEN' },
    data:  { balance: { increment: 500 } },
  });

  if (count === 0) {
    throw Object.assign(
      new Error('No se pudo aplicar el cargo: la cuenta ya no está abierta (se cerró primero).'),
      { status: 409 }
    );
  }
  return count;
}

async function main() {
  const fixtures = await setupFixtures();
  const { store, user, account } = fixtures;

  try {
    console.log('\n--- CASO 1: close() vs. un cargo concurrente sobre una cuenta en $0 ---');

    const authUser = { id: user.id, storeId: store.id, isSistema: false };

    const results = await Promise.allSettled([
      currentAccountServices.close(account.id, authUser),
      simulateConcurrentCharge(account.id),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    assert(fulfilled.length === 1, 'exactamente una de las dos operaciones tuvo éxito');
    assert(rejected.length === 1, 'exactamente una de las dos operaciones fue rechazada');
    assert(rejected[0]?.reason?.status === 409, 'la operación rechazada lanza status 409');

    const finalAccount = await prisma.currentAccount.findUnique({ where: { id: account.id } });

    const closedWithResidualBalance = finalAccount.status === 'CLOSED' && toNumber(finalAccount.balance) !== 0;
    assert(!closedWithResidualBalance, 'invariante: NUNCA queda una cuenta CLOSED con saldo distinto de 0');

    if (results[0].status === 'fulfilled') {
      assert(finalAccount.status === 'CLOSED', 'si el cierre ganó la carrera, el status final es CLOSED');
      assert(toNumber(finalAccount.balance) === 0, 'si el cierre ganó la carrera, el saldo final sigue siendo 0');
    } else {
      assert(finalAccount.status === 'OPEN', 'si el cargo ganó la carrera, el cierre fue rechazado y la cuenta sigue OPEN');
      assert(toNumber(finalAccount.balance) === 500, 'si el cargo ganó la carrera, el saldo refleja el cargo aplicado ($500)');
    }
  } finally {
    await cleanup(fixtures);
    await prisma.$disconnect();
  }

  if (process.exitCode === 1) {
    console.error('\n❌ Algunas aserciones de close-race.test.js fallaron.');
    process.exit(1);
  }
  console.log('\n✅ Todos los tests de close-race.test.js pasaron.');
}

if (require.main === module) {
  main().catch(async (err) => {
    console.error('❌ FALLO INESPERADO en close-race.test.js:', err.message);
    await prisma.$disconnect().catch(() => {});
    process.exit(1);
  });
}

// Exported so tests/run-all.js can `await` this test instead of relying on
// require()'s synchronous side effects (this test does real async I/O).
module.exports = main;
