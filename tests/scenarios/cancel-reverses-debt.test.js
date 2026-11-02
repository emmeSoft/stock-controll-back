/**
 * cancel-reverses-debt.test.js — Escenario: anular una venta a crédito revierte la deuda
 * ─────────────────────────────────────────────────────────────────
 * Dos casos, trazando sale-cancellation "Debt Reversal on Cancellation":
 *
 *   CASO 1: una venta de $1000 pagada 100% por Cuenta Corriente eleva el
 *   saldo del cliente a $1000. Al anularla, el saldo debe volver a su
 *   valor PRE-venta ($0) y debe crearse un movimiento `ADJUSTMENT` nuevo
 *   (nunca se reutiliza ni se borra el movimiento `SALE` original — su
 *   `orderId` es @unique y queda intacto). El stock también se revierte.
 *
 *   CASO 2: una venta pagada 100% en efectivo, para un cliente que SÍ
 *   tiene una cuenta corriente abierta, no crea ningún movimiento en esa
 *   cuenta. Al anular esa venta, el saldo y el conteo de movimientos de la
 *   cuenta no cambian en absoluto — `cancel` nunca toca `CurrentAccount`
 *   cuando no existe un `CurrentAccountMovement` para esa orden.
 *
 * Ejecutar con: node tests/scenarios/cancel-reverses-debt.test.js
 * ─────────────────────────────────────────────────────────────────
 */

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const salesServices = require('../../services/salesServices');
const { toNumber } = require('../../utils/money');

const prisma = new PrismaClient();

const TEST_PASSWORD = 'sale-cancel-test-pw';

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

  const store = await prisma.store.create({ data: { name: '__cancel_reverses_debt_test_store__' } });

  const hashedPassword = await bcrypt.hash(TEST_PASSWORD, 10);
  const user = await prisma.user.create({
    data: {
      store:    { connect: { id: store.id } },
      email:    `cancel-reverses-debt-${Date.now()}@test.local`,
      password: hashedPassword,
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
      email:   'cliente-cancel-reverses-debt@test.local',
      firstName: 'Cliente',
      lastName:  'AnulacionTest',
      dni:     '00000003',
      phoneNumber: '000',
      address: 'Test',
      city:    'Test',
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

  return { store, user, client, cashRegister };
}

async function cleanupOrder(orderId) {
  if (!orderId) return;
  await prisma.currentAccountMovement.deleteMany({ where: { orderId } }).catch(() => {});
  await prisma.orderDetail.deleteMany({ where: { orderId } }).catch(() => {});
  await prisma.orderPayment.deleteMany({ where: { orderId } }).catch(() => {});
  await prisma.appliedDiscount.deleteMany({ where: { orderId } }).catch(() => {});
  await prisma.order.delete({ where: { id: orderId } }).catch(() => {});
}

async function cleanup({ store, user, client, cashRegister, account, productIds = [], orderIds = [] }) {
  for (const orderId of orderIds) {
    await cleanupOrder(orderId);
  }
  // Por si quedó algún movimiento ADJUSTMENT (sin orderId) sin limpiar arriba.
  if (account) {
    await prisma.currentAccountMovement.deleteMany({ where: { currentAccountId: account.id } }).catch(() => {});
    await prisma.currentAccount.delete({ where: { id: account.id } }).catch(() => {});
  }
  for (const productId of productIds) {
    await prisma.stockHistory.deleteMany({ where: { productId } }).catch(() => {});
    await prisma.product.delete({ where: { id: productId } }).catch(() => {});
  }
  await prisma.cashMovement.deleteMany({ where: { cashRegisterId: cashRegister.id } }).catch(() => {});
  await prisma.cashRegister.delete({ where: { id: cashRegister.id } }).catch(() => {});
  await prisma.client.delete({ where: { id: client.id } }).catch(() => {});
  await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
  await prisma.store.delete({ where: { id: store.id } }).catch(() => {});
}

async function main() {
  const fixtures = await setupFixtures();
  const { store, user, client, cashRegister } = fixtures;

  // `user.rbacRole?.name === 'SISTEMA'` bypasea el chequeo de permiso
  // `account.payment` dentro de `salesServices.create` sin necesitar
  // seedear permisos reales — es un chequeo sobre el objeto `user` pasado
  // directamente, no una re-consulta a la DB.
  const authUser = { id: user.id, storeId: store.id, isSistema: false, rbacRole: { name: 'SISTEMA' } };

  let account;
  const productIds = [];
  const orderIds = [];

  try {
    console.log('\n--- CASO 1: anular una venta 100% a Cuenta Corriente revierte la deuda ---');

    account = await prisma.currentAccount.create({
      data: {
        client: { connect: { id: client.id } },
        store:  { connect: { id: store.id } },
        balance: 0,
        status:  'OPEN',
      },
    });

    const ccProduct = await prisma.product.create({
      data: { storeId: store.id, name: '__cancel_cc_test_product__', price: 1000, stock: 5 },
    });
    productIds.push(ccProduct.id);

    const ccOrder = await salesServices.create(
      {
        items: [{ id: ccProduct.id, quantity: 1 }],
        clientId: client.id,
        paymentBreakdown: [{ method: 'CUENTA_CORRIENTE', amount: 1000 }],
        amount: 1000,
      },
      authUser
    );
    orderIds.push(ccOrder.id);

    const accountAfterSale = await prisma.currentAccount.findUnique({ where: { id: account.id } });
    assert(
      toNumber(accountAfterSale.balance) === 1000,
      `tras la venta a crédito, el saldo sube a $1000 (visto: $${toNumber(accountAfterSale.balance)})`
    );

    const movementsAfterSale = await prisma.currentAccountMovement.findMany({
      where: { currentAccountId: account.id },
    });
    assert(movementsAfterSale.length === 1, 'existe exactamente un movimiento (SALE) tras la venta');
    assert(movementsAfterSale[0]?.type === 'SALE', 'el movimiento de la venta es de tipo SALE');
    assert(movementsAfterSale[0]?.orderId === ccOrder.id, 'el movimiento SALE está vinculado al orderId de la venta');

    const productBeforeCancel = await prisma.product.findUnique({ where: { id: ccProduct.id } });
    assert(productBeforeCancel.stock === 4, `el stock bajó a 4 tras la venta (visto: ${productBeforeCancel.stock})`);

    const cancelled = await salesServices.cancel(ccOrder.id, TEST_PASSWORD, authUser);
    assert(cancelled.status === 'CANCELLED', 'la venta queda en status CANCELLED');

    const accountAfterCancel = await prisma.currentAccount.findUnique({ where: { id: account.id } });
    assert(
      toNumber(accountAfterCancel.balance) === 0,
      `tras anular, el saldo vuelve a su valor pre-venta ($0, visto: $${toNumber(accountAfterCancel.balance)})`
    );

    const movementsAfterCancel = await prisma.currentAccountMovement.findMany({
      where: { currentAccountId: account.id },
      orderBy: { createdAt: 'asc' },
    });
    assert(movementsAfterCancel.length === 2, `existen exactamente 2 movimientos tras la anulación: SALE + ADJUSTMENT (visto: ${movementsAfterCancel.length})`);
    assert(movementsAfterCancel[0]?.type === 'SALE', 'el primer movimiento sigue siendo el SALE original, intacto');
    assert(movementsAfterCancel[0]?.orderId === ccOrder.id, 'el movimiento SALE original conserva su orderId (nunca se reutiliza ni se borra)');
    assert(movementsAfterCancel[1]?.type === 'ADJUSTMENT', 'el segundo movimiento es un ADJUSTMENT nuevo');
    assert(movementsAfterCancel[1]?.orderId === null, 'el movimiento ADJUSTMENT NO lleva orderId (ese campo es @unique y ya está tomado por el original)');
    assert(
      toNumber(movementsAfterCancel[1]?.debtAmount) === -1000,
      `el ADJUSTMENT revierte exactamente los $1000 de deuda (debtAmount visto: ${toNumber(movementsAfterCancel[1]?.debtAmount)})`
    );

    const productAfterCancel = await prisma.product.findUnique({ where: { id: ccProduct.id } });
    assert(productAfterCancel.stock === 5, `el stock vuelve a 5 tras la anulación (visto: ${productAfterCancel.stock})`);

    const stockHistoryReturn = await prisma.stockHistory.findFirst({
      where: { productId: ccProduct.id, type: 'RETURN' },
    });
    assert(stockHistoryReturn !== null, 'se registró un StockHistory de tipo RETURN para la anulación');
    if (stockHistoryReturn) {
      assert(stockHistoryReturn.previousStock === 4, `StockHistory RETURN previousStock es 4 (visto: ${stockHistoryReturn.previousStock})`);
      assert(stockHistoryReturn.currentStock === 5, `StockHistory RETURN currentStock es 5 (visto: ${stockHistoryReturn.currentStock})`);
    }

    console.log('\n--- CASO 2: anular una venta 100% en efectivo NO toca la Cuenta Corriente ---');

    const cashProduct = await prisma.product.create({
      data: { storeId: store.id, name: '__cancel_cash_test_product__', price: 500, stock: 5 },
    });
    productIds.push(cashProduct.id);

    const cashOrder = await salesServices.create(
      {
        items: [{ id: cashProduct.id, quantity: 1 }],
        clientId: client.id, // el cliente SÍ tiene cuenta abierta, pero esta venta es 100% efectivo
        paymentBreakdown: [{ method: 'Efectivo', amount: 500 }],
        amount: 500,
      },
      authUser
    );
    orderIds.push(cashOrder.id);

    const noMovementForCashOrder = await prisma.currentAccountMovement.findUnique({
      where: { orderId: cashOrder.id },
    });
    assert(noMovementForCashOrder === null, 'la venta en efectivo no crea ningún CurrentAccountMovement');

    const balanceBeforeCashCancel = await prisma.currentAccount.findUnique({ where: { id: account.id } });
    const movementCountBeforeCashCancel = await prisma.currentAccountMovement.count({
      where: { currentAccountId: account.id },
    });

    const cashCancelled = await salesServices.cancel(cashOrder.id, TEST_PASSWORD, authUser);
    assert(cashCancelled.status === 'CANCELLED', 'la venta en efectivo queda en status CANCELLED tras anularla');

    const balanceAfterCashCancel = await prisma.currentAccount.findUnique({ where: { id: account.id } });
    const movementCountAfterCashCancel = await prisma.currentAccountMovement.count({
      where: { currentAccountId: account.id },
    });

    assert(
      toNumber(balanceAfterCashCancel.balance) === toNumber(balanceBeforeCashCancel.balance),
      'anular una venta en efectivo no modifica el saldo de la cuenta corriente del cliente'
    );
    assert(
      movementCountAfterCashCancel === movementCountBeforeCashCancel,
      `anular una venta en efectivo no crea ni modifica movimientos de CurrentAccount (antes: ${movementCountBeforeCashCancel}, después: ${movementCountAfterCashCancel})`
    );
  } finally {
    await cleanup({ ...fixtures, account, productIds, orderIds });
    await prisma.$disconnect();
  }

  if (process.exitCode === 1) {
    console.error('\n❌ Algunas aserciones de cancel-reverses-debt.test.js fallaron.');
    process.exit(1);
  }
  console.log('\n✅ Todos los tests de cancel-reverses-debt.test.js pasaron.');
}

if (require.main === module) {
  main().catch(async (err) => {
    console.error('❌ FALLO INESPERADO en cancel-reverses-debt.test.js:', err.message);
    await prisma.$disconnect().catch(() => {});
    process.exit(1);
  });
}

// Exported so tests/run-all.js can `await` this test instead of relying on
// require()'s synchronous side effects (this test does real async I/O).
module.exports = main;
