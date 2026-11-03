/**
 * caja-close-race.test.js — Concurrencia: dos cierres simultáneos sobre la misma caja
 * ─────────────────────────────────────────────────────────────────
 * Verifica que `cajaServices.closeRegister` usa un guard atómico a nivel DB
 * (`updateMany` con `WHERE status: 'OPEN'` como PRIMER statement de la tx),
 * nunca un read-then-if: con una caja en status OPEN y dos cierres
 * concurrentes, exactamente UNO debe tener éxito y el otro debe ser
 * rechazado con status 409 / code CASH_REGISTER_ALREADY_CLOSED — y los
 * totales persistidos (`closingAmount`, `expectedAmount`, `difference`,
 * `observation`) deben ser EXCLUSIVAMENTE los del ganador, nunca
 * sobre-escritos silenciosamente por el perdedor.
 *
 * Mismo mecanismo de dos-partes (two-party barrier) que
 * `payment-race.test.js` / `sale-race.test.js`: patchea el `$transaction`
 * del singleton compartido `db/database.prisma` para forzar que ambas
 * llamadas lleguen a la entrada de su transacción antes de que cualquiera
 * de las dos avance — determinístico por construcción, no por timing
 * ("no fixed delays", ver design.md Decisión 8). Restaurado en `finally`.
 *
 * `closeRegister` requiere password correcta ANTES de la tx (bcrypt.compare
 * corre fuera del lock, por diseño) — el fixture necesita un hash real.
 *
 * Requiere una base de datos local con RBAC seedeado (al menos un Role
 * existente) — correr `node prisma/seedRbac.js` si falla por falta de Role.
 *
 * Ejecutar con: node tests/concurrency/caja-close-race.test.js
 * ─────────────────────────────────────────────────────────────────
 */

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const cajaServices = require('../../services/cajaServices');
const { toNumber } = require('../../utils/money');

const prisma = new PrismaClient();

const TEST_PASSWORD = 'caja-close-race-test-pw';

// `cajaServices.js` requiere su propio singleton `db/database.prisma`
// (misma instancia cacheada por require() que usa este test). Ver
// design.md Decisión 8, nota sobre identidad de require-cache.
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

  const store = await prisma.store.create({ data: { name: '__caja_close_race_test_store__' } });

  const hashedPassword = await bcrypt.hash(TEST_PASSWORD, 10);
  const user = await prisma.user.create({
    data: {
      store:    { connect: { id: store.id } },
      email:    `caja-close-race-${Date.now()}@test.local`,
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

async function cleanup({ store, user, cashRegister }) {
  await prisma.cashMovement.deleteMany({ where: { cashRegisterId: cashRegister.id } }).catch(() => {});
  await prisma.cashRegister.deleteMany({ where: { id: cashRegister.id } }).catch(() => {});
  await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
  await prisma.store.delete({ where: { id: store.id } }).catch(() => {});
}

async function main() {
  const fixtures = await setupFixtures();
  const { store, user, cashRegister } = fixtures;

  try {
    console.log('\n--- CASO 1: dos cierres concurrentes sobre la misma caja OPEN ---');

    const authUser = { id: user.id, storeId: store.id, isSimulating: false };

    patchTransactionBarrier(2);
    let results;
    try {
      results = await Promise.allSettled([
        cajaServices.closeRegister({ closingAmount: 111.11, observation: 'cierre A', password: TEST_PASSWORD }, authUser),
        cajaServices.closeRegister({ closingAmount: 222.22, observation: 'cierre B', password: TEST_PASSWORD }, authUser),
      ]);
    } finally {
      restoreTransaction();
    }

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    assert(fulfilled.length === 1, 'exactamente un cierre tuvo éxito');
    assert(rejected.length === 1, 'exactamente un cierre fue rechazado');
    assert(rejected[0]?.reason?.status === 409, 'el cierre rechazado lanza status 409');
    assert(
      rejected[0]?.reason?.code === 'CASH_REGISTER_ALREADY_CLOSED',
      `el cierre rechazado lleva code CASH_REGISTER_ALREADY_CLOSED (visto: ${rejected[0]?.reason?.code})`
    );

    const winner = fulfilled[0].value;

    const finalRegister = await prisma.cashRegister.findUnique({ where: { id: cashRegister.id } });
    assert(finalRegister.status === 'CLOSED', 'la caja terminó en status CLOSED');
    assert(
      toNumber(finalRegister.closingAmount) === toNumber(winner.closingAmount),
      `closingAmount persistido es el del GANADOR (visto: ${toNumber(finalRegister.closingAmount)}, esperado: ${toNumber(winner.closingAmount)})`
    );
    assert(
      toNumber(finalRegister.expectedAmount) === toNumber(winner.expectedAmount),
      'expectedAmount persistido es el del ganador'
    );
    assert(
      toNumber(finalRegister.difference) === toNumber(winner.difference),
      'difference persistido es el del ganador'
    );
    assert(
      finalRegister.observation === winner.observation,
      `observation persistida es la del ganador (visto: "${finalRegister.observation}", esperado: "${winner.observation}")`
    );

    // El perdedor NUNCA debe haber pisado los valores del ganador — ninguno
    // de los dos observations/closingAmount del perdedor debe aparecer.
    const loserClosingAmount = winner.observation === 'cierre A' ? 222.22 : 111.11;
    assert(
      toNumber(finalRegister.closingAmount) !== loserClosingAmount,
      'el valor del perdedor NUNCA sobre-escribió silenciosamente al ganador'
    );
  } finally {
    await cleanup(fixtures);
    await prisma.$disconnect();
  }

  if (process.exitCode === 1) {
    console.error('\n❌ Algunas aserciones de caja-close-race.test.js fallaron.');
    process.exit(1);
  }
  console.log('\n✅ Todos los tests de caja-close-race.test.js pasaron.');
}

if (require.main === module) {
  main().catch(async (err) => {
    console.error('❌ FALLO INESPERADO en caja-close-race.test.js:', err.message);
    await prisma.$disconnect().catch(() => {});
    process.exit(1);
  });
}

// Exported so tests/run-all.js can `await` this test instead of relying on
// require()'s synchronous side effects (this test does real async I/O).
module.exports = main;
