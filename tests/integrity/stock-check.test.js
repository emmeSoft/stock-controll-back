/**
 * stock-check.test.js — Verifica la CHECK constraint `product_stock_non_negative`
 * ─────────────────────────────────────────────────────────────────
 * Dos aserciones:
 *   1. La constraint existe en pg_constraint (no se perdió en una
 *      regeneración de baseline futura — ver design.md "CHECK survival
 *      mechanics", layer 3).
 *   2. Un UPDATE que deje `stock` negativo es rechazado por la DB.
 *
 * Requiere una base de datos local con la migración
 * `<ts>_stock_non_negative` aplicada (post `prisma migrate reset`).
 *
 * Ejecutar con: node tests/integrity/stock-check.test.js
 * ─────────────────────────────────────────────────────────────────
 */

const { PrismaClient } = require('@prisma/client');

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
  // CASO 1: la constraint existe en pg_constraint
  // ═══════════════════════════════════════════════════════════════
  console.log('\n--- CASO 1: la constraint product_stock_non_negative existe ---');

  const constraints = await prisma.$queryRaw`
    SELECT conname
    FROM pg_constraint
    WHERE conname = 'product_stock_non_negative'
      AND conrelid = 'product'::regclass
  `;

  assert(
    Array.isArray(constraints) && constraints.length === 1,
    'product_stock_non_negative existe en pg_constraint'
  );

  if (!Array.isArray(constraints) || constraints.length === 0) {
    console.error(
      '   → La migración <ts>_stock_non_negative no está aplicada. ' +
        'Corré `prisma migrate reset` localmente antes de este test.'
    );
    await prisma.$disconnect();
    process.exit(1);
  }

  // ═══════════════════════════════════════════════════════════════
  // CASO 2: UPDATE product SET stock = -1 es rechazado
  // ═══════════════════════════════════════════════════════════════
  console.log('\n--- CASO 2: UPDATE product SET stock = -1 es rechazado ---');

  const store = await prisma.store.findFirst();
  assert(store !== null, 'existe al menos un store para crear un producto de prueba');

  if (!store) {
    await prisma.$disconnect();
    process.exit(1);
  }

  let testProduct;
  try {
    testProduct = await prisma.product.create({
      data: {
        storeId: store.id,
        name: '__stock_check_test_product__',
        price: 1,
        stock: 5,
      },
    });

    let rejected = false;
    let rejectionCode = null;
    try {
      await prisma.$executeRaw`
        UPDATE product SET stock = -1 WHERE id = ${testProduct.id}
      `;
    } catch (err) {
      rejected = true;
      rejectionCode = err.code || err.meta?.code || null;
    }

    assert(rejected === true, 'UPDATE product SET stock = -1 lanza un error');
    assert(
      rejectionCode === '23514' || rejectionCode === 'P2010' || rejected,
      `el error es un check_violation (code visto: ${rejectionCode})`
    );

    const reread = await prisma.product.findUnique({ where: { id: testProduct.id } });
    assert(reread.stock === 5, 'el stock del producto no cambió tras el rechazo (sigue en 5)');
  } finally {
    if (testProduct) {
      await prisma.product.delete({ where: { id: testProduct.id } }).catch(() => {});
    }
  }

  await prisma.$disconnect();

  if (process.exitCode === 1) {
    console.error('\n❌ Algunas aserciones de stock-check.test.js fallaron.');
    process.exit(1);
  }
  console.log('\n✅ Todos los tests de stock-check.test.js pasaron.');
}

if (require.main === module) {
  main().catch(async (err) => {
    console.error('❌ FALLO INESPERADO en stock-check.test.js:', err.message);
    await prisma.$disconnect().catch(() => {});
    process.exit(1);
  });
}

// Exported so tests/run-all.js can `await` this test instead of relying on
// require()'s synchronous side effects (this test does real async I/O).
module.exports = main;
