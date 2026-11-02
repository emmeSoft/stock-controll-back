/**
 * serializer.test.js — Tests del helper middlewares/decimalSerializer.js
 * ─────────────────────────────────────────────────────────────────
 * Verifica que el interceptor global de res.json convierta toda
 * instancia de Prisma.Decimal a Number (HALF_UP, 2 decimales) sin
 * importar dónde aparezca en el body: nivel superior, anidado en un
 * objeto, o dentro de un array de objetos. También verifica que un
 * body sin Decimals no se vea afectado, que Date sobreviva intacto,
 * y que el valor serializado sea un number real en JSON (no string).
 *
 * Ejecutar con: node tests/money/serializer.test.js
 * ─────────────────────────────────────────────────────────────────
 */

const decimalSerializer = require('../../middlewares/decimalSerializer');
const { deepSerialize } = decimalSerializer;
const { money } = require('../../utils/money');

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FALLO: ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

// ═══════════════════════════════════════════════════════════════
// CASO 1: Decimal en el nivel superior del body
// ═══════════════════════════════════════════════════════════════
console.log('\n--- CASO 1: Decimal a nivel superior ---');

{
  const body = { amount: money(1234.565) };
  const result = deepSerialize(body);
  assert(typeof result.amount === 'number', 'amount pasa de Decimal a typeof number');
  assert(result.amount === 1234.57, 'amount se redondea HALF_UP a 2 decimales (1234.565 -> 1234.57)');
}

// ═══════════════════════════════════════════════════════════════
// CASO 2: Decimal anidado dentro de un objeto
// ═══════════════════════════════════════════════════════════════
console.log('\n--- CASO 2: Decimal anidado en objeto ---');

{
  const body = {
    order: {
      id: 1,
      total: money(2023.685),
      customer: { name: 'Juan', balance: money(789.125) },
    },
  };
  const result = deepSerialize(body);
  assert(typeof result.order.total === 'number', 'order.total pasa a typeof number');
  assert(result.order.total === 2023.69, 'order.total HALF_UP (2023.685 -> 2023.69)');
  assert(typeof result.order.customer.balance === 'number', 'order.customer.balance (2 niveles de anidamiento) pasa a typeof number');
  assert(result.order.customer.balance === 789.13, 'order.customer.balance HALF_UP (789.125 -> 789.13)');
}

// ═══════════════════════════════════════════════════════════════
// CASO 3: Decimal dentro de un array de objetos
// ═══════════════════════════════════════════════════════════════
console.log('\n--- CASO 3: Decimal en array de objetos ---');

{
  const body = {
    items: [
      { id: 1, price: money(100.005) },
      { id: 2, price: money(200.015) },
      { id: 3, price: money(50) },
    ],
  };
  const result = deepSerialize(body);
  assert(Array.isArray(result.items), 'items sigue siendo un array');
  assert(result.items.every((i) => typeof i.price === 'number'), 'todo price dentro del array es typeof number');
  assert(result.items[0].price === 100.01, 'items[0].price HALF_UP (100.005 -> 100.01)');
  assert(result.items[1].price === 200.02, 'items[1].price HALF_UP (200.015 -> 200.02)');
  assert(result.items[2].price === 50, 'items[2].price sin decimales se mantiene en 50');
}

// ═══════════════════════════════════════════════════════════════
// CASO 4: body sin Decimals no se ve afectado
// ═══════════════════════════════════════════════════════════════
console.log('\n--- CASO 4: body sin Decimals ---');

{
  const body = { id: 1, name: 'Producto', active: true, tags: ['a', 'b'], meta: null };
  const result = deepSerialize(body);
  assert(JSON.stringify(result) === JSON.stringify(body), 'un body sin Decimals sale idéntico al de entrada');
}

// ═══════════════════════════════════════════════════════════════
// CASO 5: Date sobrevive intacto (no se desarma en sus campos internos)
// ═══════════════════════════════════════════════════════════════
console.log('\n--- CASO 5: Date sobrevive ---');

{
  const createdAt = new Date('2026-11-02T12:00:00.000Z');
  const body = { createdAt, amount: money(10) };
  const result = deepSerialize(body);
  assert(result.createdAt instanceof Date, 'createdAt sigue siendo instancia de Date, no se recorre con Object.entries');
  assert(result.createdAt.toISOString() === createdAt.toISOString(), 'createdAt conserva su valor original');
}

// ═══════════════════════════════════════════════════════════════
// CASO 6: el valor serializado es un number real en JSON, no un string
// ═══════════════════════════════════════════════════════════════
console.log('\n--- CASO 6: number real en JSON, no string ---');

{
  const body = { amount: money(42.5) };
  const result = deepSerialize(body);
  const json = JSON.stringify(result);
  assert(json === '{"amount":42.5}', 'JSON.stringify emite 42.5 sin comillas, como number (no "42.5")');
  assert(typeof JSON.parse(json).amount === 'number', 'round-trip JSON.parse confirma typeof number');
}

// ═══════════════════════════════════════════════════════════════
// CASO 7: integración con el middleware real (wrap de res.json)
// ═══════════════════════════════════════════════════════════════
console.log('\n--- CASO 7: integración del middleware sobre un res falso ---');

{
  let sentBody = null;
  const fakeRes = {
    json(body) {
      sentBody = body;
      return this;
    },
  };
  let nextCalled = false;

  decimalSerializer({}, fakeRes, () => {
    nextCalled = true;
  });

  assert(nextCalled, 'el middleware llama a next()');
  assert(typeof fakeRes.json === 'function', 'res.json sigue siendo una función tras el wrap');

  fakeRes.json({ total: money(99.995), nested: [{ price: money(1.005) }] });

  assert(typeof sentBody.total === 'number', 'res.json envuelto convierte Decimal a number a nivel superior');
  assert(sentBody.total === 100, 'res.json envuelto redondea HALF_UP (99.995 -> 100)');
  assert(typeof sentBody.nested[0].price === 'number', 'res.json envuelto convierte Decimal dentro de un array anidado');
}

console.log('\n✅ Todos los tests de serializer.js pasaron.');
