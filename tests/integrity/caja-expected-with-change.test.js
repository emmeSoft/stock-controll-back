/**
 * caja-expected-with-change.test.js — Invariante de caja con ventas con vuelto
 * ─────────────────────────────────────────────────────────────────
 * Cubre design.md Decisión 6 / spec "Balanced drawer with an overpaid cash
 * sale and change given back": porque `OrderPayment.amount` de una pata en
 * efectivo es siempre el NETO aplicado a la venta, el excedente entregado
 * como vuelto NUNCA entra en ninguna fórmula de caja. `closeRegister` queda
 * byte-idéntico (no se tocó ningún código ahí) — esta es la prueba, no una
 * suposición.
 *
 * Esta app no tiene cajón de efectivo real: "entregar el vuelto" es
 * puramente un hecho contable — lo que se verifica es que los NÚMEROS
 * registrados sean correctos, no un movimiento físico.
 *
 *   CASO 1: un turno con 2 ventas en efectivo sobrepagadas (vuelto > 0) y
 *   una tercera también sobrepagada que luego se anula. `expectedAmount`
 *   del cierre debe ser exactamente `openingAmount + Σ NET de las ventas
 *   NO anuladas` (nunca el bruto recibido), `difference === 0`.
 *
 *   CASO 2: CERO filas `CashMovement` fueron creadas por ninguna de las
 *   ventas — el vuelto nunca es un movimiento de caja.
 *
 *   CASO 3: `cajaServices.getRegisterHistory(...).totals.vueltosEntregados`
 *   y `cajaServices.getAllRegisters(...)[...].totals.vueltosEntregados`
 *   (para el registro de este turno) son iguales a Σ `changeAmount` de las
 *   ventas NO anuladas del turno — EXCLUYENDO la venta anulada, aunque esa
 *   venta también estuviera sobrepagada. Corre ANTES de cerrar la caja,
 *   porque `getRegisterHistory` requiere una caja abierta.
 *
 * Requiere una base de datos local/real con RBAC seedeado.
 *
 * Ejecutar con: node tests/integrity/caja-expected-with-change.test.js
 * ─────────────────────────────────────────────────────────────────
 */

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const salesServices = require('../../services/salesServices');
const cajaServices = require('../../services/cajaServices');
const { toNumber } = require('../../utils/money');

const prisma = new PrismaClient();

const TEST_PASSWORD = 'caja-expected-with-change-test-pw';

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

  const store = await prisma.store.create({ data: { name: '__caja_expected_with_change_test_store__' } });

  const hashedPassword = await bcrypt.hash(TEST_PASSWORD, 10);
  const user = await prisma.user.create({
    data: {
      store:    { connect: { id: store.id } },
      email:    `caja-expected-with-change-${Date.now()}@test.local`,
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
    data: { storeId: store.id, name: '__caja_expected_with_change_test_product__', price: 100, stock: 999 },
  });

  const cashRegister = await prisma.cashRegister.create({
    data: {
      store:        { connect: { id: store.id } },
      openedByUser: { connect: { id: user.id } },
      openingAmount: 1000.00,
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
  await prisma.cashRegister.deleteMany({ where: { id: cashRegister.id } }).catch(() => {});
  await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
  await prisma.store.delete({ where: { id: store.id } }).catch(() => {});
}

async function main() {
  const fixtures = await setupFixtures();
  const { store, user, product, cashRegister } = fixtures;
  const authUser = { id: user.id, storeId: store.id, isSistema: false };
  const orderIds = [];

  try {
    console.log('\n--- Preparación: 2 ventas sobrepagadas + 1 sobrepagada que luego se anula, mismo turno ---');

    // Venta 1: amount 100, received 150 → change 50, net 100.
    const sale1 = await salesServices.create(
      {
        items: [{ id: product.id, quantity: 1 }],
        paymentBreakdown: [{ method: 'Efectivo', amount: 100, receivedAmount: 150 }],
        amount: 100,
      },
      authUser
    );
    orderIds.push(sale1.id);

    // Venta 2: amount 200, received 250 → change 50, net 200.
    const sale2 = await salesServices.create(
      {
        items: [{ id: product.id, quantity: 2 }],
        paymentBreakdown: [{ method: 'Efectivo', amount: 200, receivedAmount: 250 }],
        amount: 200,
      },
      authUser
    );
    orderIds.push(sale2.id);

    // Venta 3: amount 300, received 400 → change 100, net 300. Se anula
    // después — su vuelto NUNCA debe entrar al agregado del turno.
    const sale3 = await salesServices.create(
      {
        items: [{ id: product.id, quantity: 3 }],
        paymentBreakdown: [{ method: 'Efectivo', amount: 300, receivedAmount: 400 }],
        amount: 300,
      },
      authUser
    );
    orderIds.push(sale3.id);

    const cancelled = await salesServices.cancel(sale3.id, TEST_PASSWORD, authUser);
    assert(cancelled.status === 'CANCELLED', 'la venta 3 (sobrepagada) queda CANCELLED antes del cierre');

    console.log('\n--- CASO 2: CERO CashMovement fueron creados por ninguna de las 3 ventas ---');

    const movementCount = await prisma.cashMovement.count({ where: { cashRegisterId: cashRegister.id } });
    assert(movementCount === 0, `CERO filas CashMovement existen para esta caja tras las 3 ventas (visto: ${movementCount})`);

    console.log('\n--- CASO 3: vueltosEntregados excluye la venta anulada, en AMBOS reportes de turno ---');
    // Corre ANTES del cierre — getRegisterHistory requiere una caja abierta.

    const history = await cajaServices.getRegisterHistory(authUser);
    assert(
      toNumber(history.totals.vueltosEntregados) === 100,
      `getRegisterHistory().totals.vueltosEntregados === 100 (50 + 50, excluyendo los $100 de la venta anulada) (visto: ${toNumber(history.totals.vueltosEntregados)})`
    );

    const allRegisters = await cajaServices.getAllRegisters(authUser, {});
    const thisRegister = allRegisters.find(r => r.id === cashRegister.id);
    assert(!!thisRegister, 'el registro de este turno aparece en getAllRegisters()');
    if (thisRegister) {
      assert(
        toNumber(thisRegister.totals.vueltosEntregados) === 100,
        `getAllRegisters()[...].totals.vueltosEntregados === 100, igual que getRegisterHistory (visto: ${toNumber(thisRegister.totals.vueltosEntregados)})`
      );
    }

    console.log('\n--- CASO 1: expectedAmount y difference del cierre usan el NETO, nunca el bruto recibido ---');

    // NET no-anulado: venta1(100) + venta2(200) = 300. La venta 3 (anulada,
    // net 300) NO entra. El excedente entregado como vuelto (50+50+100=200
    // en total, 100 de las no-anuladas) tampoco entra en ninguna parte de
    // esta fórmula — ese es exactamente el invariante bajo prueba.
    const expectedNet = 1000 + 100 + 200;

    const closed = await cajaServices.closeRegister(
      { closingAmount: expectedNet, password: TEST_PASSWORD },
      authUser
    );

    assert(
      toNumber(closed.expectedAmount) === expectedNet,
      `expectedAmount === openingAmount + Σ NET de ventas no-anuladas (1000 + 100 + 200 = ${expectedNet}), nunca el bruto recibido (visto: ${toNumber(closed.expectedAmount)})`
    );
    assert(
      toNumber(closed.difference) === 0,
      `difference === 0 (visto: ${toNumber(closed.difference)})`
    );
  } finally {
    await cleanup({ store, user, product, cashRegister, orderIds });
    await prisma.$disconnect();
  }

  if (process.exitCode === 1) {
    console.error('\n❌ Algunas aserciones de caja-expected-with-change.test.js fallaron.');
    process.exit(1);
  }
  console.log('\n✅ Todos los tests de caja-expected-with-change.test.js pasaron.');
}

if (require.main === module) {
  main().catch(async (err) => {
    console.error('❌ FALLO INESPERADO en caja-expected-with-change.test.js:', err.message);
    await prisma.$disconnect().catch(() => {});
    process.exit(1);
  });
}

// Exported so tests/run-all.js can `await` this test instead of relying on
// require()'s synchronous side effects (this test does real async I/O).
module.exports = main;
