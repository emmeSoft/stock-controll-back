/**
 * stock-edit-race.test.js — Concurrencia: dos ajustes manuales simultáneos sobre el mismo producto
 * ─────────────────────────────────────────────────────────────────
 * Verifica que `productsServices.adjustStock` usa un guard atómico a nivel
 * DB (`updateMany` con `WHERE stock: { gte: -delta } }`), nunca un
 * read-then-write: con un producto en stock 5 y dos ajustes concurrentes
 * que restan 3 y 4 unidades respectivamente (7 en total, más de lo
 * disponible), exactamente UNO debe tener éxito y el otro debe ser
 * rechazado con status 409 — el stock final nunca debe quedar negativo.
 *
 * Requiere una base de datos local con RBAC seedeado (al menos un Role
 * existente) — correr `node prisma/seedRbac.js` si falla por falta de Role.
 *
 * Ejecutar con: node tests/concurrency/stock-edit-race.test.js
 * ─────────────────────────────────────────────────────────────────
 */

const { PrismaClient } = require('@prisma/client');
const productsServices = require('../../services/productsServices');

const prisma = new PrismaClient();

// `productsServices.js` requiere su propio singleton `db/database.prisma`
// (misma instancia cacheada por require() que usa este test). `adjustStock`
// hace una lectura de existencia/ownership (friendly 404) ANTES de abrir su
// `$transaction` con el guard atómico real (`updateMany`). Igual que en
// `payment-race.test.js` y `sale-race.test.js` (Units 3/4), en un Postgres
// local rápido una de las dos llamadas puede completar TODO su recorrido
// (lectura + transacción, commit) antes de que la otra siquiera comience,
// lo que dejaría que la carrera no se ejerza de verdad. Se usa la misma
// barrera determinística de dos partes: cada llamada incrementa un
// contador compartido al entrar a `$transaction` y espera una Promise
// compartida que se resuelve solo cuando el contador llega al número de
// partes esperado (2), garantizando por construcción — no por timing — que
// ambas llamadas lleguen a la entrada de la transacción antes de que
// cualquiera avance. Restaurada inmediatamente después de la carrera.
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

  const store = await prisma.store.create({ data: { name: '__stock_edit_race_test_store__' } });

  const user = await prisma.user.create({
    data: {
      store:    { connect: { id: store.id } },
      email:    `stock-edit-race-${Date.now()}@test.local`,
      password: 'x',
      firstName: 'Test',
      lastName:  'User',
      phoneNumber: '000',
      address:  'Test',
      city:     'Test',
      rbacRole: { connect: { id: role.id } },
    },
  });

  const product = await prisma.product.create({
    data: {
      storeId: store.id,
      name: '__stock_edit_race_test_product__',
      price: 100,
      stock: 5,
    },
  });

  return { store, user, product };
}

async function cleanup({ store, user, product }) {
  await prisma.stockHistory.deleteMany({ where: { productId: product.id } }).catch(() => {});
  await prisma.product.delete({ where: { id: product.id } }).catch(() => {});
  await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
  await prisma.store.delete({ where: { id: store.id } }).catch(() => {});
}

async function main() {
  const fixtures = await setupFixtures();
  const { store, user, product } = fixtures;

  try {
    console.log('\n--- CASO 1: dos ajustes concurrentes (-3 y -4) sobre un stock de 5 ---');

    const authUser = { id: user.id, storeId: store.id, isSistema: false };

    const deltas = { A: -3, B: -4 };

    patchTransactionBarrier(2);
    let results;
    try {
      results = await Promise.allSettled([
        productsServices.adjustStock(product.id, deltas.A, 'Ajuste de prueba A', authUser),
        productsServices.adjustStock(product.id, deltas.B, 'Ajuste de prueba B', authUser),
      ]);
    } finally {
      restoreTransaction();
    }

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    assert(fulfilled.length === 1, 'exactamente un ajuste tuvo éxito');
    assert(rejected.length === 1, 'exactamente un ajuste fue rechazado');
    assert(
      rejected[0]?.reason?.status === 409,
      `el ajuste rechazado lanza status 409, no 400 por un pre-check prematuro (visto: ${rejected[0]?.reason?.status})`
    );

    // Cuál de los dos deltas gana la carrera NO es determinístico (depende
    // del orden de arbitraje de locks de fila en Postgres una vez que ambas
    // llamadas llegan a la entrada de la transacción al mismo tiempo) — por
    // eso las aserciones de abajo se derivan del delta que efectivamente
    // ganó, en vez de asumir cuál de los dos (A o B) fue.
    const winningDelta = fulfilled[0].value.stock - 5;
    assert(
      winningDelta === deltas.A || winningDelta === deltas.B,
      `el delta ganador es uno de los dos intentos (-3 o -4, visto: ${winningDelta})`
    );

    const finalProduct = await prisma.product.findUnique({ where: { id: product.id } });
    assert(
      finalProduct.stock === 5 + winningDelta,
      `el stock final refleja exactamente el delta que ganó la carrera (esperado: ${5 + winningDelta}, visto: ${finalProduct.stock})`
    );
    assert(finalProduct.stock >= 0, 'el stock NUNCA queda negativo');

    const histories = await prisma.stockHistory.findMany({
      where: { productId: product.id, type: 'MANUAL_ADJUSTMENT' },
    });
    assert(histories.length === 1, `se creó exactamente un StockHistory de tipo MANUAL_ADJUSTMENT, no uno por cada intento (visto: ${histories.length})`);

    if (histories.length === 1) {
      assert(histories[0].previousStock === 5, `previousStock es 5 (visto: ${histories[0].previousStock})`);
      assert(histories[0].currentStock === 5 + winningDelta, `currentStock refleja el delta ganador (visto: ${histories[0].currentStock})`);
      assert(histories[0].movementAmount === winningDelta, `movementAmount es el delta que ganó la carrera (visto: ${histories[0].movementAmount})`);
    }
  } finally {
    await cleanup(fixtures);
    await prisma.$disconnect();
  }

  if (process.exitCode === 1) {
    console.error('\n❌ Algunas aserciones de stock-edit-race.test.js fallaron.');
    process.exit(1);
  }
  console.log('\n✅ Todos los tests de stock-edit-race.test.js pasaron.');
}

if (require.main === module) {
  main().catch(async (err) => {
    console.error('❌ FALLO INESPERADO en stock-edit-race.test.js:', err.message);
    await prisma.$disconnect().catch(() => {});
    process.exit(1);
  });
}

// Exported so tests/run-all.js can `await` this test instead of relying on
// require()'s synchronous side effects (this test does real async I/O).
module.exports = main;
