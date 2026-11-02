/**
 * run-all.js — Sequential test runner (house style, no framework)
 * ─────────────────────────────────────────────────────────────────
 * Each registered test file is a plain `node`-executable script using
 * local `assert()` helpers that `console.error` + `process.exit(1)` on
 * failure. Since `require()` executes the file's top-level code, a
 * failing test halts this entire process immediately (process.exit
 * kills the host process, not just the required module) — so this
 * loop needs no extra failure handling of its own.
 *
 * Add new DB-backed / unit scripts here as later apply batches land.
 *
 * Ejecutar con: node tests/run-all.js
 * (también disponible como `npm run test:integrity`)
 * ─────────────────────────────────────────────────────────────────
 */

const tests = [
  './money/money.test.js',
  './money/serializer.test.js',
  './integrity/stock-check.test.js',
  './concurrency/payment-race.test.js',
  './concurrency/close-race.test.js',
  './scenarios/cc-exact-payment.test.js',
  './concurrency/sale-race.test.js',
  './scenarios/cancel-reverses-debt.test.js',
];

async function main() {
  for (const test of tests) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`RUNNING: ${test}`);
    console.log('='.repeat(60));

    // Synchronous test files (house style) run their asserts as a side
    // effect of require() and call process.exit(1) themselves on failure.
    // Async/DB-backed test files export their main function instead, so
    // we can actually await completion before moving to the next test —
    // required for correct sequencing (`require()` alone would race past
    // unresolved promises and print a false "ALL PASSED" banner).
    const exported = require(test);
    if (typeof exported === 'function') {
      await exported();
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log('✅ ALL REGISTERED TESTS PASSED');
  console.log('='.repeat(60));
}

main().catch((err) => {
  console.error(`\n❌ FALLO INESPERADO en tests/run-all.js: ${err.message}`);
  process.exit(1);
});
