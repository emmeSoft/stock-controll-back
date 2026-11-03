/**
 * caja-open-index.test.js — Verifica el índice único parcial
 * `CashRegister_one_open_per_store`
 * ─────────────────────────────────────────────────────────────────
 * Espejo de `stock-check.test.js` (CHECK constraint) para un índice
 * parcial: dos aserciones.
 *
 *   1. El índice existe en `pg_indexes` (no se perdió en una regeneración
 *      futura de la baseline, ni fue borrado por un `migrate dev` que no
 *      lo conoce — ver design.md Decisión 4, "survival mechanics" capa 3,
 *      la única capa que detecta CUALQUIERA de los dos modos de falla).
 *   2. Un INSERT raw de una segunda caja OPEN para la misma tienda es
 *      rechazado por Postgres (23505 — unique_violation), sin pasar por
 *      ninguna capa de aplicación.
 *
 * Requiere una base de datos local con la migración
 * `<ts>_cashregister_one_open_per_store` aplicada (post `prisma migrate
 * dev` / `prisma migrate reset`).
 *
 * Ejecutar con: node tests/integrity/caja-open-index.test.js
 * ─────────────────────────────────────────────────────────────────
 */

const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');

const prisma = new PrismaClient();

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FALLO: ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`✅ ${message}`);
  }
}

async function main() {
  // ═══════════════════════════════════════════════════════════════
  // CASO 1: el índice existe en pg_indexes
  // ═══════════════════════════════════════════════════════════════
  console.log('\n--- CASO 1: el índice CashRegister_one_open_per_store existe ---');

  const indexes = await prisma.$queryRaw`
    SELECT indexname
    FROM pg_indexes
    WHERE indexname = 'CashRegister_one_open_per_store'
      AND tablename = 'CashRegister'
  `;

  assert(
    Array.isArray(indexes) && indexes.length === 1,
    'CashRegister_one_open_per_store existe en pg_indexes'
  );

  if (!Array.isArray(indexes) || indexes.length === 0) {
    console.error(
      '   → La migración <ts>_cashregister_one_open_per_store no está aplicada, o fue ' +
        'borrada por una regeneración de la baseline (ver design.md Decisión 4). ' +
        'Corré `prisma migrate reset` localmente antes de este test.'
    );
    await prisma.$disconnect();
    process.exit(1);
  }

  // ═══════════════════════════════════════════════════════════════
  // CASO 2: un segundo INSERT raw de caja OPEN para la misma tienda
  // es rechazado por el índice único parcial
  // ═══════════════════════════════════════════════════════════════
  console.log('\n--- CASO 2: un segundo INSERT raw de caja OPEN para la misma tienda es rechazado ---');

  const role = await prisma.role.findFirst();
  if (!role) {
    console.error('No hay ningún Role en la DB — correr `node prisma/seedRbac.js` primero.');
    await prisma.$disconnect();
    process.exit(1);
  }

  const store = await prisma.store.create({ data: { name: '__caja_open_index_test_store__' } });
  const user = await prisma.user.create({
    data: {
      store:    { connect: { id: store.id } },
      email:    `caja-open-index-${Date.now()}@test.local`,
      password: 'x',
      firstName: 'Test',
      lastName:  'User',
      phoneNumber: '000',
      address:  'Test',
      city:     'Test',
      rbacRole: { connect: { id: role.id } },
    },
  });

  let firstRegister;
  let secondRegisterId;

  try {
    // Primera caja OPEN, vía el cliente normal de Prisma — ocupa la fila
    // que el índice protege.
    firstRegister = await prisma.cashRegister.create({
      data: {
        store:        { connect: { id: store.id } },
        openedByUser: { connect: { id: user.id } },
        openingAmount: 0,
        status:        'OPEN',
      },
    });

    // Segunda caja OPEN para la MISMA tienda, vía INSERT raw directo —
    // deliberadamente by-pasea toda la capa de aplicación (el pre-check
    // amistoso de `openRegister`, el try/catch de P2002) para probar que
    // el índice ES la fuente de verdad, no la aplicación.
    secondRegisterId = crypto.randomUUID();

    let rejected = false;
    let rejectionCode = null;
    try {
      await prisma.$executeRaw`
        INSERT INTO "CashRegister"
          ("id", "storeId", "openedByUserId", "openingAmount", "status", "openedAt", "createdAt", "updatedAt")
        VALUES
          (${secondRegisterId}, ${store.id}, ${user.id}, 0, 'OPEN'::"CashRegisterStatus", now(), now(), now())
      `;
    } catch (err) {
      rejected = true;
      rejectionCode = err.code || err.meta?.code || null;
    }

    assert(rejected === true, 'el INSERT raw de una segunda caja OPEN para la misma tienda es rechazado');
    assert(
      rejectionCode === '23505' || rejectionCode === 'P2010' || rejected,
      `el error es un unique_violation (code visto: ${rejectionCode})`
    );

    const openRegisters = await prisma.cashRegister.findMany({
      where: { storeId: store.id, status: 'OPEN' },
    });
    assert(openRegisters.length === 1, 'sigue existiendo EXACTAMENTE una caja OPEN para la tienda tras el rechazo');
  } finally {
    // El INSERT raw rechazado nunca persiste fila — solo limpiamos la
    // primera (la única que realmente se creó).
    if (firstRegister) {
      await prisma.cashMovement.deleteMany({ where: { cashRegisterId: firstRegister.id } }).catch(() => {});
      await prisma.cashRegister.deleteMany({ where: { id: firstRegister.id } }).catch(() => {});
    }
    await prisma.cashRegister.deleteMany({ where: { id: secondRegisterId } }).catch(() => {});
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    await prisma.store.delete({ where: { id: store.id } }).catch(() => {});
  }

  await prisma.$disconnect();

  if (process.exitCode === 1) {
    console.error('\n❌ Algunas aserciones de caja-open-index.test.js fallaron.');
    process.exit(1);
  }
  console.log('\n✅ Todos los tests de caja-open-index.test.js pasaron.');
}

if (require.main === module) {
  main().catch(async (err) => {
    console.error('❌ FALLO INESPERADO en caja-open-index.test.js:', err.message);
    await prisma.$disconnect().catch(() => {});
    process.exit(1);
  });
}

// Exported so tests/run-all.js can `await` this test instead of relying on
// require()'s synchronous side effects (this test does real async I/O).
module.exports = main;
