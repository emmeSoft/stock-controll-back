/**
 * cash-change.test.js — Escenario: vuelto (cambio) en pagos en efectivo
 * ─────────────────────────────────────────────────────────────────
 * Cubre la Unit B/C de `cash-change-calculation` (design.md Decisiones 2-5):
 * `receivedAmount` obligatorio por cada pata en efectivo, insuficiencia con
 * tolerancia CERO, `changeAmount` calculado y persistido, `OrderPayment.amount`
 * siempre NETO, patas no-efectivo ignoran `receivedAmount` por completo.
 *
 *   CASO 1: `receivedAmount` ausente / no-numérico / cero / negativo en una
 *   pata "Efectivo" (el string LITERAL que manda el frontend, no "EFECTIVO")
 *   → 400 CASH_RECEIVED_REQUIRED, CERO órdenes creadas (verificado por
 *   count, no solo por el error lanzado). Si el detector esperara
 *   "EFECTIVO" en mayúsculas, esta pata caería en la rama "se ignora en
 *   silencio" y la venta pasaría — exactamente lo que este caso evita.
 *
 *   CASO 2: `receivedAmount` insuficiente (100 pata, 99.99 recibido) → 400
 *   CASH_RECEIVED_INSUFFICIENT, el mensaje nombra ambas cifras.
 *
 *   CASO 3: pago exacto (`receivedAmount === amount`) → aceptado,
 *   `changeAmount === 0`.
 *
 *   CASO 4: sobrepago (100/150) → `OrderPayment.amount` sigue siendo el
 *   NETO (100), `receivedAmount`/`changeAmount` persistidos correctamente,
 *   Σ `paymentBreakdown.amount === order.amount` se mantiene, la respuesta
 *   trae `change` en el nivel superior.
 *
 *   CASO 5: split efectivo + tarjeta — el vuelto se calcula SOLO sobre la
 *   pata en efectivo; la pata de tarjeta queda intacta.
 *
 *   CASO 6: split efectivo + CUENTA_CORRIENTE — el vuelto se calcula SOLO
 *   sobre la pata en efectivo; la deuda de CC crece exactamente el monto de
 *   esa pata, nunca se reduce por el excedente entregado en efectivo.
 *
 *   CASO 7: una pata NO-efectivo (Tarjeta) que trae un `receivedAmount`
 *   igual se ignora por completo — no se valida, no se persiste (ambas
 *   columnas quedan `NULL`).
 *
 *   CASO 8: precisión de float — `receivedAmount: 19.999999999999996`
 *   contra una pata de `amount` exactamente `20` NO debe lanzar
 *   CASH_RECEIVED_INSUFFICIENT (ambos lados se redondean a 2 decimales
 *   antes de comparar, fix de la misma Unit B, commit `cb8c282`); el
 *   `receivedAmount` en la respuesta vuelve limpio a 2 decimales (`20`, no
 *   el float crudo del cliente) — prueba que viaja por el `_receivedAmount`
 *   ya redondeado, no por el valor crudo del cliente.
 *
 *   CASO 9: paridad de descuento — una regla ORDER_LEVEL gateada por
 *   método de pago ("Efectivo") calcula el mismo descuento sea que la
 *   pata en efectivo venga exacta o con un excedente grande de
 *   `receivedAmount` — confirma que `baseAmount`/la fórmula proporcional
 *   del motor de descuentos nunca mira `receivedAmount`, solo `amount`.
 *
 * Requiere una base de datos local/real con RBAC seedeado.
 *
 * Ejecutar con: node tests/scenarios/cash-change.test.js
 * ─────────────────────────────────────────────────────────────────
 */

const { PrismaClient } = require('@prisma/client');
const salesServices = require('../../services/salesServices');
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

async function makeFixtures(label) {
  const role = await prisma.role.findFirst();
  if (!role) throw new Error('No hay ningún Role en la DB — correr `node prisma/seedRbac.js` primero.');

  const store = await prisma.store.create({ data: { name: `__cash_change_${label}_test_store__` } });

  const user = await prisma.user.create({
    data: {
      store:    { connect: { id: store.id } },
      email:    `cash-change-${label}-${Date.now()}@test.local`,
      password: 'x',
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

async function cleanupOrder(orderId) {
  if (!orderId) return;
  await prisma.currentAccountMovement.deleteMany({ where: { orderId } }).catch(() => {});
  await prisma.orderDetail.deleteMany({ where: { orderId } }).catch(() => {});
  await prisma.orderPayment.deleteMany({ where: { orderId } }).catch(() => {});
  await prisma.appliedDiscount.deleteMany({ where: { orderId } }).catch(() => {});
  await prisma.order.delete({ where: { id: orderId } }).catch(() => {});
}

async function cleanupFixtures({ store, user, cashRegister, productIds = [], orderIds = [], client, account, rule }) {
  for (const orderId of orderIds) {
    await cleanupOrder(orderId);
  }
  if (account) {
    await prisma.currentAccountMovement.deleteMany({ where: { currentAccountId: account.id } }).catch(() => {});
    await prisma.currentAccount.delete({ where: { id: account.id } }).catch(() => {});
  }
  if (rule) {
    await prisma.discountRule.delete({ where: { id: rule.id } }).catch(() => {});
  }
  for (const productId of productIds) {
    await prisma.stockHistory.deleteMany({ where: { productId } }).catch(() => {});
    await prisma.product.delete({ where: { id: productId } }).catch(() => {});
  }
  await prisma.cashMovement.deleteMany({ where: { cashRegisterId: cashRegister.id } }).catch(() => {});
  await prisma.cashRegister.delete({ where: { id: cashRegister.id } }).catch(() => {});
  if (client) await prisma.client.delete({ where: { id: client.id } }).catch(() => {});
  await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
  await prisma.store.delete({ where: { id: store.id } }).catch(() => {});
}

async function main() {
  // ═══════════════════════════════════════════════════════════════
  // BLOQUE 1: validación, cómputo de vuelto, splits, patas no-efectivo
  // ═══════════════════════════════════════════════════════════════
  {
    const fixtures = await makeFixtures('main');
    const { store, user, cashRegister } = fixtures;
    const authUser = { id: user.id, storeId: store.id, isSistema: false, rbacRole: { name: 'SISTEMA' } };
    const orderIds = [];
    const productIds = [];
    let client, account;

    try {
      const productA = await prisma.product.create({
        data: { storeId: store.id, name: '__cash_change_product_a__', price: 100, stock: 999 },
      });
      productIds.push(productA.id);

      const productB = await prisma.product.create({
        data: { storeId: store.id, name: '__cash_change_product_b__', price: 20, stock: 999 },
      });
      productIds.push(productB.id);

      console.log('\n--- CASO 1: receivedAmount ausente/no-numérico/cero/negativo en una pata "Efectivo" (string literal) ---');

      const invalidReceived = [
        { label: 'ausente', breakdown: [{ method: 'Efectivo', amount: 100 }] },
        { label: '0', breakdown: [{ method: 'Efectivo', amount: 100, receivedAmount: 0 }] },
        { label: '-5', breakdown: [{ method: 'Efectivo', amount: 100, receivedAmount: -5 }] },
        { label: "'abc'", breakdown: [{ method: 'Efectivo', amount: 100, receivedAmount: 'abc' }] },
        { label: 'NaN', breakdown: [{ method: 'Efectivo', amount: 100, receivedAmount: NaN }] },
      ];

      for (const { label, breakdown } of invalidReceived) {
        let thrown = null;
        try {
          await salesServices.create(
            { items: [{ id: productA.id, quantity: 1 }], paymentBreakdown: breakdown, amount: 100 },
            authUser
          );
        } catch (err) {
          thrown = err;
        }
        assert(thrown !== null, `receivedAmount ${label}: lanza un error`);
        if (thrown) {
          assert(thrown.status === 400, `receivedAmount ${label}: status === 400 (obtuvo ${thrown.status})`);
          assert(thrown.code === 'CASH_RECEIVED_REQUIRED', `receivedAmount ${label}: code === 'CASH_RECEIVED_REQUIRED' (obtuvo ${thrown.code})`);
        }
      }

      const ordersAfterInvalid = await prisma.order.count({ where: { storeId: store.id } });
      assert(ordersAfterInvalid === 0, `CERO órdenes fueron creadas tras los 5 intentos rechazados (visto: ${ordersAfterInvalid})`);

      console.log('\n--- CASO 2: receivedAmount insuficiente (pata de $100, recibido $99.99) ---');

      let insufficientError = null;
      try {
        await salesServices.create(
          {
            items: [{ id: productA.id, quantity: 1 }],
            paymentBreakdown: [{ method: 'Efectivo', amount: 100, receivedAmount: 99.99 }],
            amount: 100,
          },
          authUser
        );
      } catch (err) {
        insufficientError = err;
      }
      assert(insufficientError !== null, 'receivedAmount insuficiente lanza un error');
      if (insufficientError) {
        assert(insufficientError.status === 400, `status === 400 (obtuvo ${insufficientError.status})`);
        assert(insufficientError.code === 'CASH_RECEIVED_INSUFFICIENT', `code === 'CASH_RECEIVED_INSUFFICIENT' (obtuvo ${insufficientError.code})`);
        assert(insufficientError.message.includes('99.99'), `el mensaje nombra el monto recibido (99.99): "${insufficientError.message}"`);
        assert(insufficientError.message.includes('100'), `el mensaje nombra el monto de la pata (100): "${insufficientError.message}"`);
      }

      const ordersAfterInsufficient = await prisma.order.count({ where: { storeId: store.id } });
      assert(ordersAfterInsufficient === 0, `CERO órdenes fueron creadas tras el intento insuficiente (visto: ${ordersAfterInsufficient})`);

      console.log('\n--- CASO 3: pago exacto (receivedAmount === amount) → changeAmount === 0 ---');

      const exactResult = await salesServices.create(
        {
          items: [{ id: productA.id, quantity: 1 }],
          paymentBreakdown: [{ method: 'Efectivo', amount: 100, receivedAmount: 100 }],
          amount: 100,
        },
        authUser
      );
      orderIds.push(exactResult.id);

      assert(toNumber(exactResult.change) === 0, `la respuesta trae change === 0 (visto: ${toNumber(exactResult.change)})`);

      const exactPayment = await prisma.orderPayment.findFirst({ where: { orderId: exactResult.id } });
      assert(toNumber(exactPayment.receivedAmount) === 100, `OrderPayment.receivedAmount persistido es 100 (visto: ${toNumber(exactPayment.receivedAmount)})`);
      assert(toNumber(exactPayment.changeAmount) === 0, `OrderPayment.changeAmount persistido es 0 (visto: ${toNumber(exactPayment.changeAmount)})`);

      console.log('\n--- CASO 4: sobrepago (100/150) → amount sigue NETO, response.change, Σ === order.amount ---');

      const overpayResult = await salesServices.create(
        {
          items: [{ id: productA.id, quantity: 1 }],
          paymentBreakdown: [{ method: 'Efectivo', amount: 100, receivedAmount: 150 }],
          amount: 100,
        },
        authUser
      );
      orderIds.push(overpayResult.id);

      assert(toNumber(overpayResult.amount) === 100, `order.amount sigue siendo el NETO (100), no el bruto (visto: ${toNumber(overpayResult.amount)})`);
      assert(toNumber(overpayResult.change) === 50, `response.change === 50 (visto: ${toNumber(overpayResult.change)})`);

      const overpayPayment = await prisma.orderPayment.findFirst({ where: { orderId: overpayResult.id } });
      assert(toNumber(overpayPayment.amount) === 100, `OrderPayment.amount persistido sigue siendo el NETO (100) (visto: ${toNumber(overpayPayment.amount)})`);
      assert(toNumber(overpayPayment.receivedAmount) === 150, `OrderPayment.receivedAmount persistido es 150 (visto: ${toNumber(overpayPayment.receivedAmount)})`);
      assert(toNumber(overpayPayment.changeAmount) === 50, `OrderPayment.changeAmount persistido es 50 (visto: ${toNumber(overpayPayment.changeAmount)})`);

      const overpayAllPayments = await prisma.orderPayment.findMany({ where: { orderId: overpayResult.id } });
      const sumPayments = overpayAllPayments.reduce((acc, p) => acc + toNumber(p.amount), 0);
      assert(sumPayments === toNumber(overpayResult.amount), `Σ OrderPayment.amount (${sumPayments}) === order.amount (${toNumber(overpayResult.amount)})`);

      console.log('\n--- CASO 5: split efectivo + tarjeta — el vuelto se calcula SOLO sobre la pata en efectivo ---');

      const splitCardResult = await salesServices.create(
        {
          items: [{ id: productA.id, quantity: 1 }],
          paymentBreakdown: [
            { method: 'Efectivo', amount: 60, receivedAmount: 100 },
            { method: 'Tarjeta', amount: 40 },
          ],
          amount: 100,
        },
        authUser
      );
      orderIds.push(splitCardResult.id);

      assert(toNumber(splitCardResult.change) === 40, `response.change === 40 (solo de la pata en efectivo) (visto: ${toNumber(splitCardResult.change)})`);

      const splitCardPayments = await prisma.orderPayment.findMany({ where: { orderId: splitCardResult.id } });
      const cashLeg = splitCardPayments.find(p => p.paymentMethod === 'Efectivo');
      const cardLeg = splitCardPayments.find(p => p.paymentMethod === 'Tarjeta');
      assert(toNumber(cashLeg.changeAmount) === 40, `la pata en efectivo persiste changeAmount === 40 (visto: ${toNumber(cashLeg.changeAmount)})`);
      assert(cardLeg.receivedAmount === null, 'la pata de tarjeta persiste receivedAmount NULL');
      assert(cardLeg.changeAmount === null, 'la pata de tarjeta persiste changeAmount NULL');
      assert(toNumber(cardLeg.amount) === 40, `la pata de tarjeta no fue afectada por el vuelto de la otra pata (amount sigue 40, visto: ${toNumber(cardLeg.amount)})`);

      console.log('\n--- CASO 6: split efectivo + CUENTA_CORRIENTE — vuelto solo en la pata efectivo, deuda CC intacta ---');

      client = await prisma.client.create({
        data: {
          store:   { connect: { id: store.id } },
          email:   'cliente-cash-change@test.local',
          firstName: 'Cliente',
          lastName:  'CashChangeTest',
          dni:     '00000099',
          phoneNumber: '000',
          address: 'Test',
          city:    'Test',
        },
      });
      account = await prisma.currentAccount.create({
        data: {
          client: { connect: { id: client.id } },
          store:  { connect: { id: store.id } },
          balance: 0,
          status:  'OPEN',
        },
      });

      const balanceBeforeCC = await prisma.currentAccount.findUnique({ where: { id: account.id } });

      const splitCCResult = await salesServices.create(
        {
          items: [{ id: productA.id, quantity: 1 }],
          clientId: client.id,
          paymentBreakdown: [
            { method: 'Efectivo', amount: 30, receivedAmount: 50 },
            { method: 'CUENTA_CORRIENTE', amount: 70 },
          ],
          amount: 100,
        },
        authUser
      );
      orderIds.push(splitCCResult.id);

      assert(toNumber(splitCCResult.change) === 20, `response.change === 20 (solo de la pata en efectivo) (visto: ${toNumber(splitCCResult.change)})`);

      const balanceAfterCC = await prisma.currentAccount.findUnique({ where: { id: account.id } });
      assert(
        toNumber(balanceAfterCC.balance) === toNumber(balanceBeforeCC.balance) + 70,
        `la deuda de CC creció exactamente $70 (el monto de la pata), nunca se redujo por el excedente de $20 entregado en efectivo (visto: +${toNumber(balanceAfterCC.balance) - toNumber(balanceBeforeCC.balance)})`
      );

      const splitCCPayments = await prisma.orderPayment.findMany({ where: { orderId: splitCCResult.id } });
      const ccLeg = splitCCPayments.find(p => p.paymentMethod === 'CUENTA_CORRIENTE');
      assert(toNumber(ccLeg.amount) === 70, `la pata CUENTA_CORRIENTE persiste amount === 70 (visto: ${toNumber(ccLeg.amount)})`);
      assert(ccLeg.receivedAmount === null, 'la pata CUENTA_CORRIENTE persiste receivedAmount NULL');
      assert(ccLeg.changeAmount === null, 'la pata CUENTA_CORRIENTE persiste changeAmount NULL');

      console.log('\n--- CASO 7: una pata NO-efectivo (Tarjeta) que trae receivedAmount es ignorada por completo ---');

      const ignoredResult = await salesServices.create(
        {
          items: [{ id: productA.id, quantity: 1 }],
          paymentBreakdown: [{ method: 'Tarjeta', amount: 100, receivedAmount: 9999 }],
          amount: 100,
        },
        authUser
      );
      orderIds.push(ignoredResult.id);

      assert(toNumber(ignoredResult.change) === 0, `response.change === 0 cuando no hay ninguna pata en efectivo (visto: ${toNumber(ignoredResult.change)})`);

      const ignoredPayment = await prisma.orderPayment.findFirst({ where: { orderId: ignoredResult.id } });
      assert(ignoredPayment.receivedAmount === null, 'el receivedAmount enviado en la pata de Tarjeta NUNCA se persiste (NULL)');
      assert(ignoredPayment.changeAmount === null, 'el changeAmount para la pata de Tarjeta es NULL (nunca se calculó)');

      console.log('\n--- CASO 8: precisión de float — receivedAmount 19.999999999999996 contra amount exactamente 20 ---');

      const floatResult = await salesServices.create(
        {
          items: [{ id: productB.id, quantity: 1 }],
          paymentBreakdown: [{ method: 'Efectivo', amount: 20, receivedAmount: 19.999999999999996 }],
          amount: 20,
        },
        authUser
      );
      orderIds.push(floatResult.id);

      assert(toNumber(floatResult.change) === 0, `no se rechaza por CASH_RECEIVED_INSUFFICIENT — ambos lados se redondean antes de comparar (change visto: ${toNumber(floatResult.change)})`);

      const cashLegFromResponse = floatResult.orderPayments.find(p => p.method === 'Efectivo' || p.paymentMethod === 'Efectivo');
      assert(
        toNumber(cashLegFromResponse.receivedAmount) === 20,
        `la respuesta devuelve receivedAmount limpio a 2 decimales (20), no el float crudo del cliente (visto: ${toNumber(cashLegFromResponse.receivedAmount)})`
      );

      const floatPayment = await prisma.orderPayment.findFirst({ where: { orderId: floatResult.id } });
      assert(toNumber(floatPayment.receivedAmount) === 20, `OrderPayment.receivedAmount persistido es 20 exacto (visto: ${toNumber(floatPayment.receivedAmount)})`);
    } finally {
      await cleanupFixtures({ ...fixtures, productIds, orderIds, client, account });
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // BLOQUE 2 (fixtures propios): CASO 9 — paridad de descuento con/sin
  // excedente de receivedAmount. Usa su PROPIA tienda para que la regla
  // ORDER_LEVEL no contamine ninguna venta del Bloque 1.
  // ═══════════════════════════════════════════════════════════════
  {
    const fixtures = await makeFixtures('discount-parity');
    const { store, user, cashRegister } = fixtures;
    const authUser = { id: user.id, storeId: store.id, isSistema: false, rbacRole: { name: 'SISTEMA' } };
    const orderIds = [];
    const productIds = [];
    let rule;

    try {
      const product = await prisma.product.create({
        data: { storeId: store.id, name: '__cash_change_discount_parity_product__', price: 1000, stock: 999 },
      });
      productIds.push(product.id);

      // Regla ORDER_LEVEL (sin `target`), gateada por método de pago
      // "Efectivo" — la fórmula proporcional de validateTicketConditions
      // (evaluator.js) usa ÚNICAMENTE `paymentBreakdown[].amount`, nunca
      // `receivedAmount`. Con una sola pata en efectivo cubriendo el 100%
      // del total, el descuento resultante debe ser IDÉNTICO sin importar
      // cuánto excedente traiga `receivedAmount`.
      rule = await prisma.discountRule.create({
        data: {
          storeId: store.id,
          name: '__cash_change_discount_parity_rule__',
          percentage: 10,
          engineVersion: 'universal',
          conditionsUniversal: {
            target: null,
            ticketConditions: { paymentMethods: ['Efectivo'], allClients: true },
          },
          isActive: true,
          createdBy: user.id,
        },
      });

      console.log('\n--- CASO 9: paridad de descuento — receivedAmount exacto vs. con excedente grande ---');

      // Producto $1000, 10% OFF → total final (NETO) = $900. El frontend
      // real recalcularía esto con un preview antes de confirmar — acá lo
      // conocemos de antemano porque con una sola pata cubriendo el 100%
      // del total, la proporción siempre da 1 sin importar el valor
      // absoluto declarado.
      const exactResult = await salesServices.create(
        {
          items: [{ id: product.id, quantity: 1 }],
          paymentBreakdown: [{ method: 'Efectivo', amount: 900, receivedAmount: 900 }],
          amount: 1000,
        },
        authUser
      );
      orderIds.push(exactResult.id);

      const overpaidResult = await salesServices.create(
        {
          items: [{ id: product.id, quantity: 1 }],
          paymentBreakdown: [{ method: 'Efectivo', amount: 900, receivedAmount: 1500 }],
          amount: 1000,
        },
        authUser
      );
      orderIds.push(overpaidResult.id);

      assert(
        toNumber(exactResult.discountSummary.discountTotal) > 0,
        `la regla de descuento efectivamente se aplicó (discountTotal > 0, visto: ${toNumber(exactResult.discountSummary.discountTotal)})`
      );
      assert(
        toNumber(exactResult.discountSummary.discountTotal) === toNumber(overpaidResult.discountSummary.discountTotal),
        `discountTotal es byte-idéntico con receivedAmount exacto (${toNumber(exactResult.discountSummary.discountTotal)}) ` +
        `vs. con un excedente de $600 (${toNumber(overpaidResult.discountSummary.discountTotal)})`
      );
      assert(
        exactResult.discountSummary.applied.length === overpaidResult.discountSummary.applied.length,
        'la cantidad de descuentos aplicados es idéntica en ambos casos'
      );
      assert(
        toNumber(exactResult.discountSummary.applied[0]?.amount ?? 0) === toNumber(overpaidResult.discountSummary.applied[0]?.amount ?? 0),
        'el monto del descuento ORDER aplicado es byte-idéntico en ambos casos'
      );
      assert(
        toNumber(exactResult.amount) === toNumber(overpaidResult.amount),
        `order.amount (NETO, post-descuento) es idéntico en ambos casos (visto: ${toNumber(exactResult.amount)} vs ${toNumber(overpaidResult.amount)})`
      );
      assert(toNumber(overpaidResult.change) === 600, `la venta sobrepagada sigue calculando su propio vuelto (600) sin afectar el descuento (visto: ${toNumber(overpaidResult.change)})`);
    } finally {
      await cleanupFixtures({ ...fixtures, productIds, orderIds, rule });
    }
  }

  await prisma.$disconnect();

  if (process.exitCode === 1) {
    console.error('\n❌ Algunas aserciones de cash-change.test.js fallaron.');
    process.exit(1);
  }
  console.log('\n✅ Todos los tests de cash-change.test.js pasaron.');
}

if (require.main === module) {
  main().catch(async (err) => {
    console.error('❌ FALLO INESPERADO en cash-change.test.js:', err.message);
    await prisma.$disconnect().catch(() => {});
    process.exit(1);
  });
}

// Exported so tests/run-all.js can `await` this test instead of relying on
// require()'s synchronous side effects (this test does real async I/O).
module.exports = main;
