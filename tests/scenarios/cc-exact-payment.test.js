/**
 * cc-exact-payment.test.js — Escenario: el bug original de la entrevista
 * ─────────────────────────────────────────────────────────────────
 * Dos cargos de $1234.56 y $789.12 sobre una cuenta corriente, pago
 * exacto de $2023.68. Bajo Float, esa suma arrastraba error de punto
 * flotante y un pago "exacto" nunca dejaba el saldo en 0 exacto,
 * bloqueando el cierre de la cuenta — el bug concreto que motivó este
 * cambio. Bajo Decimal, la suma es exacta y el ciclo completo
 * (cargo → cargo → pago exacto → cierre) debe funcionar de punta a
 * punta a través de `addSaleDebt`, `registerPayment` y `close`.
 *
 * Ejecutar con: node tests/scenarios/cc-exact-payment.test.js
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

  const store = await prisma.store.create({ data: { name: '__cc_exact_payment_test_store__' } });

  const user = await prisma.user.create({
    data: {
      store:    { connect: { id: store.id } },
      email:    `cc-exact-payment-${Date.now()}@test.local`,
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
      email:   'cliente-pago-exacto@test.local',
      firstName: 'Cliente',
      lastName:  'PagoExactoTest',
      dni:     '00000002',
      phoneNumber: '000',
      address: 'Test',
      city:    'Test',
    },
  });

  return { store, user, client };
}

async function cleanup({ store, user, client, account, orders, cashRegister }) {
  if (account) await prisma.currentAccountMovement.deleteMany({ where: { currentAccountId: account.id } }).catch(() => {});
  if (cashRegister) await prisma.cashMovement.deleteMany({ where: { cashRegisterId: cashRegister.id } }).catch(() => {});
  if (account) await prisma.currentAccount.delete({ where: { id: account.id } }).catch(() => {});
  for (const order of orders || []) {
    await prisma.order.delete({ where: { id: order.id } }).catch(() => {});
  }
  if (cashRegister) await prisma.cashRegister.delete({ where: { id: cashRegister.id } }).catch(() => {});
  await prisma.client.delete({ where: { id: client.id } }).catch(() => {});
  await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
  await prisma.store.delete({ where: { id: store.id } }).catch(() => {});
}

async function main() {
  const fixtures = await setupFixtures();
  const { store, user, client } = fixtures;
  const authUser = { id: user.id, storeId: store.id, isSistema: false };

  let account;
  let orders = [];
  let cashRegister;

  try {
    console.log('\n--- CASO 1: dos cargos (1234.56 + 789.12) acumulan un saldo exacto ---');

    account = await currentAccountServices.open(client.id, authUser);

    const order1 = await prisma.order.create({
      data: {
        store:  { connect: { id: store.id } },
        client: { connect: { id: client.id } },
        user:   { connect: { id: user.id } },
        amount: 1234.56,
        status: 'completed',
      },
    });
    const order2 = await prisma.order.create({
      data: {
        store:  { connect: { id: store.id } },
        client: { connect: { id: client.id } },
        user:   { connect: { id: user.id } },
        amount: 789.12,
        status: 'completed',
      },
    });
    orders = [order1, order2];

    await prisma.$transaction((tx) =>
      currentAccountServices.addSaleDebt(tx, {
        orderId: order1.id, clientId: client.id, storeId: store.id, userId: user.id,
        totalAmount: order1.amount, paidAmount: 0,
      })
    );
    await prisma.$transaction((tx) =>
      currentAccountServices.addSaleDebt(tx, {
        orderId: order2.id, clientId: client.id, storeId: store.id, userId: user.id,
        totalAmount: order2.amount, paidAmount: 0,
      })
    );

    const afterCharges = await prisma.currentAccount.findUnique({ where: { id: account.id } });
    assert(
      toNumber(afterCharges.balance) === 2023.68,
      `el saldo acumulado es exactamente $2023.68 (visto: $${toNumber(afterCharges.balance)}, sin arrastre de punto flotante)`
    );

    console.log('\n--- CASO 2: un pago de exactamente $2023.68 es aceptado y deja el saldo en 0 ---');

    cashRegister = await prisma.cashRegister.create({
      data: {
        store:        { connect: { id: store.id } },
        openedByUser: { connect: { id: user.id } },
        openingAmount: 0,
        status:        'OPEN',
      },
    });

    const paymentResult = await currentAccountServices.registerPayment(
      { clientId: client.id, amount: 2023.68, paymentMethod: 'Efectivo' },
      authUser
    );

    assert(
      toNumber(paymentResult.account.balance) === 0,
      `el saldo tras el pago exacto es exactamente 0 (visto: $${toNumber(paymentResult.account.balance)})`
    );

    console.log('\n--- CASO 3: con saldo 0, el cierre de la cuenta tiene éxito ---');

    const closed = await currentAccountServices.close(account.id, authUser);
    assert(closed.status === 'CLOSED', 'la cuenta cierra exitosamente tras el pago exacto');
  } finally {
    await cleanup({ store, user, client, account, orders, cashRegister });
    await prisma.$disconnect();
  }

  if (process.exitCode === 1) {
    console.error('\n❌ Algunas aserciones de cc-exact-payment.test.js fallaron.');
    process.exit(1);
  }
  console.log('\n✅ Todos los tests de cc-exact-payment.test.js pasaron.');
}

if (require.main === module) {
  main().catch(async (err) => {
    console.error('❌ FALLO INESPERADO en cc-exact-payment.test.js:', err.message);
    await prisma.$disconnect().catch(() => {});
    process.exit(1);
  });
}

// Exported so tests/run-all.js can `await` this test instead of relying on
// require()'s synchronous side effects (this test does real async I/O).
module.exports = main;
