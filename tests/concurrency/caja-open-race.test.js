/**
 * caja-open-race.test.js — Concurrencia: dos terminales abriendo la caja de la misma tienda
 * ─────────────────────────────────────────────────────────────────
 * Verifica `Exactly-Once Register Open Per Store`: con dos llamadas
 * concurrentes a `openRegister` para la MISMA tienda (dos terminales
 * compitiendo), exactamente UNA debe tener éxito y la otra debe ser
 * rechazada con status 409 / code CASH_REGISTER_ALREADY_OPEN — nunca debe
 * existir más de una caja `status: 'OPEN'` para la misma tienda al mismo
 * tiempo.
 *
 * `openRegister` NO usa `$transaction` (design.md Decisión 4: "un solo
 * INSERT ya es atómico; el índice único parcial `CashRegister_one_open_per_store`
 * es el árbitro real"), así que el two-party barrier de los demás tests de
 * concurrencia (que patchea `$transaction`) no tiene nada a lo que
 * enganchar aquí. En su lugar, se patchea DIRECTAMENTE
 * `svcPrisma.cashRegister.create` con el MISMO mecanismo de barrier de
 * dos partes: cada llamada incrementa un contador compartido al llegar a
 * la entrada del INSERT, y espera una Promise compartida que se libera
 * solo cuando el contador llega a 2 — ambas llamadas garantizan haber
 * pasado su pre-check amistoso (findFirst) y su `bcrypt.compare` ANTES de
 * que cualquiera ejecute el INSERT real, forzando a que el índice único
 * parcial (no el pre-check) sea el árbitro real de la carrera. Ningún
 * fixed-delay — restaurado en `finally` (design.md Decisión 8).
 *
 * Fixture: `openRegister` corre `bcrypt.compare` antes del punto de
 * carrera, así que el usuario de prueba necesita un hash real
 * (`bcrypt.hash`, mismo patrón que `movement-validation.test.js:49`).
 *
 * Requiere una base de datos local con RBAC seedeado.
 *
 * Ejecutar con: node tests/concurrency/caja-open-race.test.js
 * ─────────────────────────────────────────────────────────────────
 */

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const cajaServices = require('../../services/cajaServices');

const prisma = new PrismaClient();

const TEST_PASSWORD = 'caja-open-race-test-pw';

// `cajaServices.js` requiere su propio singleton `db/database.prisma` —
// misma instancia cacheada por require() que usa este test (ver nota de
// identidad de require-cache en design.md Decisión 8).
const svcPrisma = require('../../db/database.prisma');
const cashRegisterDelegate = svcPrisma.cashRegister;
const originalCreate = cashRegisterDelegate.create.bind(cashRegisterDelegate);
function patchCreateBarrier(partyCount) {
  let arrived = 0;
  let releaseBarrier;
  const barrier = new Promise((resolve) => { releaseBarrier = resolve; });
  cashRegisterDelegate.create = async (args) => {
    arrived += 1;
    if (arrived >= partyCount) releaseBarrier();
    await barrier;
    return originalCreate(args);
  };
}
function restoreCreate() {
  cashRegisterDelegate.create = originalCreate;
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

  const store = await prisma.store.create({ data: { name: '__caja_open_race_test_store__' } });

  const hashedPassword = await bcrypt.hash(TEST_PASSWORD, 10);
  const user = await prisma.user.create({
    data: {
      store:    { connect: { id: store.id } },
      email:    `caja-open-race-${Date.now()}@test.local`,
      password: hashedPassword,
      firstName: 'Test',
      lastName:  'User',
      phoneNumber: '000',
      address:  'Test',
      city:     'Test',
      rbacRole: { connect: { id: role.id } },
    },
  });

  return { store, user };
}

async function cleanup({ store, user }, registerIds = []) {
  for (const id of registerIds) {
    await prisma.cashMovement.deleteMany({ where: { cashRegisterId: id } }).catch(() => {});
    await prisma.cashRegister.deleteMany({ where: { id } }).catch(() => {});
  }
  await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
  await prisma.store.delete({ where: { id: store.id } }).catch(() => {});
}

async function main() {
  const fixtures = await setupFixtures();
  const { store, user } = fixtures;
  let registerIds = [];

  try {
    console.log('\n--- CASO 1: dos terminales abren la caja de la misma tienda al mismo tiempo ---');

    const authUser = { id: user.id, storeId: store.id, isSimulating: false };
    const openData = { openingAmount: 0, password: TEST_PASSWORD };

    patchCreateBarrier(2);
    let results;
    try {
      results = await Promise.allSettled([
        cajaServices.openRegister(openData, authUser),
        cajaServices.openRegister(openData, authUser),
      ]);
    } finally {
      restoreCreate();
    }

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    registerIds = fulfilled.map((r) => r.value.id);

    assert(fulfilled.length === 1, 'exactamente una apertura tuvo éxito');
    assert(rejected.length === 1, 'exactamente una apertura fue rechazada');
    assert(rejected[0]?.reason?.status === 409, `la apertura rechazada lanza status 409 (visto: ${rejected[0]?.reason?.status})`);
    assert(
      rejected[0]?.reason?.code === 'CASH_REGISTER_ALREADY_OPEN',
      `la apertura rechazada lleva code CASH_REGISTER_ALREADY_OPEN (visto: ${rejected[0]?.reason?.code})`
    );

    const openRegisters = await prisma.cashRegister.findMany({
      where: { storeId: store.id, status: 'OPEN' },
    });
    assert(openRegisters.length === 1, `existe EXACTAMENTE una caja OPEN para la tienda (visto: ${openRegisters.length})`);
  } finally {
    await cleanup(fixtures, registerIds);
    await prisma.$disconnect();
  }

  if (process.exitCode === 1) {
    console.error('\n❌ Algunas aserciones de caja-open-race.test.js fallaron.');
    process.exit(1);
  }
  console.log('\n✅ Todos los tests de caja-open-race.test.js pasaron.');
}

if (require.main === module) {
  main().catch(async (err) => {
    console.error('❌ FALLO INESPERADO en caja-open-race.test.js:', err.message);
    await prisma.$disconnect().catch(() => {});
    process.exit(1);
  });
}

// Exported so tests/run-all.js can `await` this test instead of relying on
// require()'s synchronous side effects (this test does real async I/O).
module.exports = main;
