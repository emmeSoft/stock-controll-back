/**
 * sale-race.test.js — Concurrencia: dos ventas simultáneas por la última unidad de stock
 * ─────────────────────────────────────────────────────────────────
 * Verifica que `salesServices.create` usa un guard atómico a nivel DB en
 * PASO 10 (`updateMany` con `WHERE stock: { gte: quantity } }`), nunca un
 * read-then-write: con un producto en stock 1 y dos ventas concurrentes de
 * 1 unidad cada una, exactamente UNA debe tener éxito (201) y la otra debe
 * ser rechazada con status 409 — el stock final nunca debe quedar negativo
 * y debe existir exactamente un `StockHistory` de tipo SALE (no uno por
 * cada intento, incluso el que fue revertido por el rollback de la tx).
 *
 * Requiere una base de datos local con RBAC seedeado (al menos un Role
 * existente) — correr `node prisma/seedRbac.js` si falla por falta de Role.
 *
 * Ejecutar con: node tests/concurrency/sale-race.test.js
 * ─────────────────────────────────────────────────────────────────
 */

const { PrismaClient } = require('@prisma/client');
const salesServices = require('../../services/salesServices');

const prisma = new PrismaClient();

// `salesServices.js` requiere su propio singleton `db/database.prisma`
// (misma instancia cacheada por require() que usa este test). A diferencia
// de `registerPayment` (Unit 3), el "pre-check amable" de `create` (PASO 1,
// `product.stock < item.quantity`) vive DENTRO de la misma $transaction que
// el guard atómico real (PASO 10) — lee contra el estado commiteado vigente,
// nunca contra un snapshot stale fuera de la tx, así que por sí solo no
// puede decidir la carrera con el status equivocado.
//
// El riesgo real es otro: si la transacción A completa TODO su recorrido
// (PASO 1 a PASO 10, commit) antes de que la transacción B siquiera
// comience, el PASO 1 de B leerá el stock YA en 0 y lanzará un Error plano
// (sin `.status`, por lo tanto 400 por el fallback del controller) en vez
// de llegar al guard atómico y recibir el 409 real — exactamente el mismo
// patrón de "la carrera no corre de verdad en este Postgres local tan
// rápido" que Unit 3 encontró en `payment-race.test.js`.
//
// Unit 3 originally forced the race with a FIXED DELAY at the entrance of
// `$transaction`. That is inherently fragile — it only widens the window
// enough if BOTH calls happen to reach the entrance within that fixed
// time, which depends on how fast/slow the machine is at that moment and
// flaked ~40% of the time under load. This test uses a deterministic
// two-party barrier instead: each call increments a shared counter upon
// entering `$transaction`, then awaits a shared Promise that resolves only
// once the counter reaches the expected party count (2, for this test).
// Both calls are guaranteed to have reached the transaction entrance — by
// construction, not by timing luck — before either proceeds into the
// transaction body, forcing the atomic `updateMany` in PASO 10 (not the
// friendly pre-check in PASO 1) to be the one that decides the race.
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

  const store = await prisma.store.create({ data: { name: '__sale_race_test_store__' } });

  const user = await prisma.user.create({
    data: {
      store:    { connect: { id: store.id } },
      email:    `sale-race-${Date.now()}@test.local`,
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
      name: '__sale_race_test_product__',
      price: 100,
      stock: 1,
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

  return { store, user, product, cashRegister };
}

async function cleanup({ store, user, product, cashRegister, orderIds = [] }) {
  for (const orderId of orderIds) {
    await prisma.orderDetail.deleteMany({ where: { orderId } }).catch(() => {});
    await prisma.orderPayment.deleteMany({ where: { orderId } }).catch(() => {});
    await prisma.appliedDiscount.deleteMany({ where: { orderId } }).catch(() => {});
    await prisma.order.delete({ where: { id: orderId } }).catch(() => {});
  }
  await prisma.stockHistory.deleteMany({ where: { productId: product.id } }).catch(() => {});
  await prisma.cashMovement.deleteMany({ where: { cashRegisterId: cashRegister.id } }).catch(() => {});
  await prisma.product.delete({ where: { id: product.id } }).catch(() => {});
  await prisma.cashRegister.delete({ where: { id: cashRegister.id } }).catch(() => {});
  await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
  await prisma.store.delete({ where: { id: store.id } }).catch(() => {});
}

async function main() {
  const fixtures = await setupFixtures();
  const { store, user, product } = fixtures;
  let orderIds = [];

  try {
    console.log('\n--- CASO 1: dos ventas concurrentes de 1 unidad sobre un stock de 1 ---');

    const authUser = { id: user.id, storeId: store.id, isSistema: false };
    const saleData = {
      items: [{ id: product.id, quantity: 1 }],
      paymentBreakdown: [{ method: 'Efectivo', amount: 100 }],
      amount: 100,
    };

    patchTransactionBarrier(2);
    let results;
    try {
      results = await Promise.allSettled([
        salesServices.create(saleData, authUser),
        salesServices.create(saleData, authUser),
      ]);
    } finally {
      restoreTransaction();
    }

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    orderIds = fulfilled.map((r) => r.value.id);

    assert(fulfilled.length === 1, 'exactamente una venta tuvo éxito (201)');
    assert(rejected.length === 1, 'exactamente una venta fue rechazada');
    assert(
      rejected[0]?.reason?.status === 409,
      `la venta rechazada lanza status 409, no 400 por un pre-check prematuro (visto: ${rejected[0]?.reason?.status})`
    );

    const finalProduct = await prisma.product.findUnique({ where: { id: product.id } });
    assert(finalProduct.stock === 0, `el stock final es exactamente 0 (visto: ${finalProduct.stock})`);
    assert(finalProduct.stock >= 0, 'el stock NUNCA queda negativo');

    const histories = await prisma.stockHistory.findMany({
      where: { productId: product.id, type: 'SALE' },
    });
    assert(histories.length === 1, `se creó exactamente un StockHistory de tipo SALE, no uno por cada intento (visto: ${histories.length})`);

    if (histories.length === 1) {
      assert(histories[0].previousStock === 1, `previousStock es 1 (visto: ${histories[0].previousStock})`);
      assert(histories[0].currentStock === 0, `currentStock es 0 (visto: ${histories[0].currentStock})`);
      assert(histories[0].movementAmount === -1, `movementAmount es -1 (visto: ${histories[0].movementAmount})`);
    }
  } finally {
    await cleanup({ ...fixtures, orderIds });
    await prisma.$disconnect();
  }

  if (process.exitCode === 1) {
    console.error('\n❌ Algunas aserciones de sale-race.test.js fallaron.');
    process.exit(1);
  }
  console.log('\n✅ Todos los tests de sale-race.test.js pasaron.');
}

if (require.main === module) {
  main().catch(async (err) => {
    console.error('❌ FALLO INESPERADO en sale-race.test.js:', err.message);
    await prisma.$disconnect().catch(() => {});
    process.exit(1);
  });
}

// Exported so tests/run-all.js can `await` this test instead of relying on
// require()'s synchronous side effects (this test does real async I/O).
module.exports = main;
