/**
 * sale-vs-caja-close-race.test.js — Concurrencia: una venta vs. un cierre de caja
 * ─────────────────────────────────────────────────────────────────
 * Verifica la invariante de `Register-Bound Operation Consistency`: una
 * venta que corre al mismo tiempo que un cierre de la MISMA caja debe
 * resolverse de una sola forma posible — o la venta aterriza y su efectivo
 * queda contado dentro del `expectedAmount` del cierre, o la venta es
 * rechazada con status 409 / code CASH_REGISTER_CLOSED. NUNCA puede
 * quedar cobrada (orden creada) y excluida del arqueo al mismo tiempo.
 *
 *   CASO 1 — barrier(2): venta ‖ cierre, verdadera carrera. Se afirma la
 *   INVARIANTE (no una interleaving fija): dado que `assertRegisterOpen`
 *   es el primer write de la tx de venta (PASO 1.5, design.md Decisión 2)
 *   y el flip de `closeRegister` es el primer write de SU tx, cualquiera
 *   de las dos puede ganar el lock de fila — la venta solo puede perder
 *   si el cierre gana primero, y en ese caso el cierre NUNCA es rechazado
 *   (solo compiten dos escrituras sobre `CashRegister`, no dos cierres).
 *
 *   CASO 2 — determinístico, cierre primero: simula el caso en que el
 *   pre-check amistoso y no-atómico `cajaServices.getCurrentRegister`
 *   (que `salesServices.create` corre ANTES de la tx) leyó la caja como
 *   OPEN un instante antes de que se cerrara desde otra terminal — exactamente
 *   la ventana de carrera real que este guard existe para cerrar. Se
 *   stubea `cajaServices.getCurrentRegister` (el pre-read no bloqueante
 *   que design.md Decisión 6 documenta como "se mantiene igual que los
 *   pre-checks de Level 1") para que devuelva la caja YA cerrada, forzando
 *   a la venta a llegar hasta el guard atómico real (PASO 1.5) en vez de
 *   fallar antes por el pre-check "no hay caja abierta" — sin usar un
 *   fixed-delay, igual de determinístico que el barrier pero para una
 *   secuencia, no una carrera.
 *
 *   CASO 3 — determinístico, venta primero: la venta se completa
 *   normalmente sobre una caja OPEN, LUEGO se cierra la caja — el
 *   `expectedAmount` del cierre debe incluir exactamente el efectivo de
 *   la venta.
 *
 * Aserción global: ninguna `order` debe existir cuyo `createdAt` sea
 * posterior al `closedAt` de su caja.
 *
 * Mismo two-party barrier que `payment-race.test.js` / `sale-race.test.js`
 * para CASO 1. Ningún fixed-delay en ningún caso — ver design.md Decisión 8.
 *
 * Requiere una base de datos local con RBAC seedeado.
 *
 * Ejecutar con: node tests/concurrency/sale-vs-caja-close-race.test.js
 * ─────────────────────────────────────────────────────────────────
 */

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const salesServices = require('../../services/salesServices');
const cajaServices = require('../../services/cajaServices');
const { toNumber } = require('../../utils/money');

const prisma = new PrismaClient();

const TEST_PASSWORD = 'sale-vs-close-race-test-pw';

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

async function makeFixtures(label) {
  const role = await prisma.role.findFirst();
  if (!role) throw new Error('No hay ningún Role en la DB — correr `node prisma/seedRbac.js` primero.');

  const store = await prisma.store.create({ data: { name: `__sale_vs_close_${label}_test_store__` } });

  const hashedPassword = await bcrypt.hash(TEST_PASSWORD, 10);
  const user = await prisma.user.create({
    data: {
      store:    { connect: { id: store.id } },
      email:    `sale-vs-close-${label}-${Date.now()}@test.local`,
      password: hashedPassword,
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
      name: `__sale_vs_close_${label}_test_product__`,
      price: 100,
      stock: 10,
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

async function cleanupFixtures({ store, user, product, cashRegister, orderIds = [] }) {
  for (const orderId of orderIds) {
    await prisma.orderDetail.deleteMany({ where: { orderId } }).catch(() => {});
    await prisma.orderPayment.deleteMany({ where: { orderId } }).catch(() => {});
    await prisma.appliedDiscount.deleteMany({ where: { orderId } }).catch(() => {});
    await prisma.order.delete({ where: { id: orderId } }).catch(() => {});
  }
  await prisma.stockHistory.deleteMany({ where: { productId: product.id } }).catch(() => {});
  await prisma.cashMovement.deleteMany({ where: { cashRegisterId: cashRegister.id } }).catch(() => {});
  await prisma.product.delete({ where: { id: product.id } }).catch(() => {});
  await prisma.cashRegister.deleteMany({ where: { id: cashRegister.id } }).catch(() => {});
  await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
  await prisma.store.delete({ where: { id: store.id } }).catch(() => {});
}

function saleData(product, qty = 1) {
  const cashAmount = toNumber(product.price) * qty;
  return {
    items: [{ id: product.id, quantity: qty }],
    paymentBreakdown: [{ method: 'Efectivo', amount: cashAmount }],
    amount: cashAmount,
  };
}

async function main() {
  // Registros usados por la aserción global al final.
  const globalRegisters = [];

  try {
    console.log('\n--- CASO 1: barrier(2) venta ‖ cierre — se verifica la INVARIANTE ---');
    {
      const fixtures = await makeFixtures('caso1');
      const { store, user, product, cashRegister } = fixtures;
      let orderIds = [];

      try {
        const authUser = { id: user.id, storeId: store.id, isSimulating: false };

        patchTransactionBarrier(2);
        let results;
        try {
          results = await Promise.allSettled([
            salesServices.create(saleData(product), authUser),
            cajaServices.closeRegister({ closingAmount: 0, password: TEST_PASSWORD }, authUser),
          ]);
        } finally {
          restoreTransaction();
        }

        const [saleResult, closeResult] = results;

        assert(closeResult.status === 'fulfilled', 'el cierre SIEMPRE tiene éxito en esta carrera (nadie más le disputa el lock de cierre)');

        if (saleResult.status === 'fulfilled') {
          orderIds = [saleResult.value.id];
          console.log('   (la venta ganó la carrera)');

          const orders = await prisma.order.findMany({ where: { cashRegisterId: cashRegister.id, status: { not: 'CANCELLED' } } });
          assert(orders.length === 1, 'exactamente una orden fue creada para esta caja');

          if (closeResult.status === 'fulfilled') {
            assert(
              toNumber(closeResult.value.expectedAmount) === toNumber(product.price),
              `expectedAmount del cierre incluye el efectivo de la venta (visto: ${toNumber(closeResult.value.expectedAmount)}, esperado: ${toNumber(product.price)})`
            );
          }
        } else {
          console.log('   (la venta perdió la carrera)');
          assert(saleResult.reason?.status === 409, `la venta rechazada lanza status 409 (visto: ${saleResult.reason?.status})`);
          assert(
            saleResult.reason?.code === 'CASH_REGISTER_CLOSED',
            `la venta rechazada lleva code CASH_REGISTER_CLOSED (visto: ${saleResult.reason?.code})`
          );

          const orders = await prisma.order.findMany({ where: { cashRegisterId: cashRegister.id } });
          assert(orders.length === 0, 'CERO órdenes existen para esta caja — la venta rechazada NUNCA quedó cobrada');

          if (closeResult.status === 'fulfilled') {
            assert(
              toNumber(closeResult.value.expectedAmount) === 0,
              'expectedAmount del cierre NO incluye la venta rechazada'
            );
          }
        }

        const finalRegister = await prisma.cashRegister.findUnique({ where: { id: cashRegister.id } });
        globalRegisters.push(finalRegister);
      } finally {
        await cleanupFixtures({ ...fixtures, orderIds });
      }
    }

    console.log('\n--- CASO 2: determinístico, cierre primero — venta llega al guard atómico con una referencia stale ---');
    {
      const fixtures = await makeFixtures('caso2');
      const { store, user, product, cashRegister } = fixtures;

      try {
        const authUser = { id: user.id, storeId: store.id, isSimulating: false };

        // Cierre real, completo, ANTES de la venta.
        await cajaServices.closeRegister({ closingAmount: 0, password: TEST_PASSWORD }, authUser);

        // `salesServices.create` llama a `cajaServices.getCurrentRegister` como
        // pre-check amistoso NO atómico ANTES de su propia tx (design.md
        // Decisión 6: "stays... fast, friendly 400 en el caso no-racing").
        // Stubeamos ESE pre-read, no el guard real, para reproducir
        // exactamente la ventana de carrera real: el pre-read vio la caja
        // abierta un instante antes de que se cerrara desde otra terminal.
        // La venta debe entonces llegar hasta `assertRegisterOpen` (PASO 1.5,
        // el guard atómico dentro de la tx) y ser rechazada POR ÉL, con
        // status 409 / code CASH_REGISTER_CLOSED — no por el pre-check
        // "no hay caja abierta" (que sería un 400 plano y no probaría nada
        // sobre el guard atómico bajo prueba).
        const originalGetCurrentRegister = cajaServices.getCurrentRegister;
        cajaServices.getCurrentRegister = async () => cashRegister;
        let saleError;
        try {
          await salesServices.create(saleData(product), authUser);
        } catch (err) {
          saleError = err;
        } finally {
          cajaServices.getCurrentRegister = originalGetCurrentRegister;
        }

        assert(!!saleError, 'la venta contra la caja ya cerrada es rechazada');
        assert(saleError?.status === 409, `la venta rechazada lanza status 409 (visto: ${saleError?.status})`);
        assert(
          saleError?.code === 'CASH_REGISTER_CLOSED',
          `la venta rechazada lleva code CASH_REGISTER_CLOSED (visto: ${saleError?.code})`
        );

        const orders = await prisma.order.findMany({ where: { cashRegisterId: cashRegister.id } });
        assert(orders.length === 0, 'CERO órdenes creadas');

        const finalProduct = await prisma.product.findUnique({ where: { id: product.id } });
        assert(finalProduct.stock === product.stock, 'el stock NO se decrementó');

        const payments = await prisma.orderPayment.findMany({ where: { order: { cashRegisterId: cashRegister.id } } });
        assert(payments.length === 0, 'ningún OrderPayment fue creado');

        const finalRegister = await prisma.cashRegister.findUnique({ where: { id: cashRegister.id } });
        globalRegisters.push(finalRegister);
      } finally {
        await cleanupFixtures({ ...fixtures, orderIds: [] });
      }
    }

    console.log('\n--- CASO 3: determinístico, venta primero — el cierre cuenta exactamente el efectivo de la venta ---');
    {
      const fixtures = await makeFixtures('caso3');
      const { store, user, product, cashRegister } = fixtures;
      let orderIds = [];

      try {
        const authUser = { id: user.id, storeId: store.id, isSimulating: false };

        const order = await salesServices.create(saleData(product, 2), authUser);
        orderIds = [order.id];

        const closed = await cajaServices.closeRegister({ closingAmount: 0, password: TEST_PASSWORD }, authUser);

        assert(
          toNumber(closed.expectedAmount) === toNumber(product.price) * 2,
          `expectedAmount incluye exactamente el efectivo de la venta (visto: ${toNumber(closed.expectedAmount)}, esperado: ${toNumber(product.price) * 2})`
        );

        globalRegisters.push(closed);
      } finally {
        await cleanupFixtures({ ...fixtures, orderIds });
      }
    }

    console.log('\n--- Aserción global: ninguna orden es posterior al cierre de su caja ---');
    for (const register of globalRegisters) {
      if (!register.closedAt) continue;
      const lateOrders = await prisma.order.findMany({
        where: { cashRegisterId: register.id, createdAt: { gt: register.closedAt } },
      });
      assert(lateOrders.length === 0, `ninguna orden de la caja ${register.id} es posterior a su closedAt`);
    }
  } finally {
    await prisma.$disconnect();
  }

  if (process.exitCode === 1) {
    console.error('\n❌ Algunas aserciones de sale-vs-caja-close-race.test.js fallaron.');
    process.exit(1);
  }
  console.log('\n✅ Todos los tests de sale-vs-caja-close-race.test.js pasaron.');
}

if (require.main === module) {
  main().catch(async (err) => {
    console.error('❌ FALLO INESPERADO en sale-vs-caja-close-race.test.js:', err.message);
    await prisma.$disconnect().catch(() => {});
    process.exit(1);
  });
}

// Exported so tests/run-all.js can `await` this test instead of relying on
// require()'s synchronous side effects (this test does real async I/O).
module.exports = main;
