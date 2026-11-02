/**
 * money.test.js — Tests del helper utils/money.js
 * ─────────────────────────────────────────────────────────────────
 * Verifica redondeo HALF_UP a 2 decimales, suma exacta de montos,
 * y validación de montos positivos/finitos.
 *
 * Ejecutar con: node tests/money/money.test.js
 * ─────────────────────────────────────────────────────────────────
 */

const { money, round, toNumber, sum, isPositiveAmount, D } = require('../../utils/money');

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FALLO: ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

// ═══════════════════════════════════════════════════════════════
// CASO 1: HALF_UP a 2 decimales
// ═══════════════════════════════════════════════════════════════
console.log('\n--- CASO 1: HALF_UP a 2 decimales ---');

assert(toNumber(1.005) === 1.01, 'round(1.005) HALF_UP -> 1.01 (no banker\'s rounding)');
assert(toNumber(1.004) === 1.00, 'round(1.004) HALF_UP -> 1.00');
assert(toNumber(2.345) === 2.35, 'round(2.345) HALF_UP -> 2.35');
assert(toNumber('10') === 10, 'round(\'10\') -> 10 (string input accepted)');
assert(toNumber(null) === 0, 'round(null) -> 0 (null defaults to zero)');
assert(toNumber(undefined) === 0, 'round(undefined) -> 0 (undefined defaults to zero)');

// ═══════════════════════════════════════════════════════════════
// CASO 2: sum() — suma exacta, sin errores de punto flotante
// ═══════════════════════════════════════════════════════════════
console.log('\n--- CASO 2: sum() ---');

const total = sum([1234.56, 789.12]);
assert(toNumber(total) === 2023.68, 'sum([1234.56, 789.12]) === 2023.68');
assert(total instanceof D, 'sum() returns a Prisma.Decimal instance');

const totalWithExtractor = sum(
  [{ amount: 100.1 }, { amount: 200.2 }, { amount: 300.3 }],
  (x) => x.amount
);
assert(toNumber(totalWithExtractor) === 600.6, 'sum() with extractor fn === 600.6');

assert(toNumber(sum([])) === 0, 'sum([]) === 0');

// ═══════════════════════════════════════════════════════════════
// CASO 3: isPositiveAmount() — rechaza negativo, cero, NaN, Infinity
// ═══════════════════════════════════════════════════════════════
console.log('\n--- CASO 3: isPositiveAmount() ---');

assert(isPositiveAmount(-1) === false, 'isPositiveAmount(-1) === false');
assert(isPositiveAmount(0) === false, 'isPositiveAmount(0) === false');
assert(isPositiveAmount(NaN) === false, 'isPositiveAmount(NaN) === false');
assert(isPositiveAmount(Infinity) === false, 'isPositiveAmount(Infinity) === false');
assert(isPositiveAmount(-Infinity) === false, 'isPositiveAmount(-Infinity) === false');
assert(isPositiveAmount(100) === true, 'isPositiveAmount(100) === true');
assert(isPositiveAmount(0.01) === true, 'isPositiveAmount(0.01) === true');
assert(isPositiveAmount('not-a-number') === false, 'isPositiveAmount(\'not-a-number\') === false (invalid Decimal input)');

// ═══════════════════════════════════════════════════════════════
// CASO 4: money() / round() return Decimal instances, not numbers
// ═══════════════════════════════════════════════════════════════
console.log('\n--- CASO 4: tipos de retorno ---');

assert(money(10) instanceof D, 'money(10) returns a Prisma.Decimal instance');
assert(round(10.129) instanceof D, 'round() returns a Prisma.Decimal instance');
assert(typeof toNumber(10.129) === 'number', 'toNumber() returns a plain number');

console.log('\n✅ Todos los tests de money.js pasaron.');
