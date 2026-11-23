/**
 * store-max-discount-pct.test.js — coerción y validación de `maxDiscountPct`
 * en `storesServices.update()` (services/storesServices.js).
 *
 * Covers el fix de "setear el tope de descuento devuelve error":
 *   - El form manda siempre string (`"75"`) — se persiste como Float real.
 *   - Fuera de rango (<1, >100) o no numérico -> error con status 400 y
 *     code INVALID_MAX_DISCOUNT_PCT (no 403, no PrismaClientValidationError).
 *   - No-SISTEMA no puede tocar el campo (ya filtrado por allowedFields).
 *
 * Ejecutar con: node tests/tier/store-max-discount-pct.test.js
 * ─────────────────────────────────────────────────────────────────
 */

require('dotenv').config();
const storesServices = require('../../services/storesServices');
const { createTestUser, cleanupTestUser } = require('../auth/helpers');

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FALLO: ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`✅ ${message}`);
  }
}

async function assertThrows(fn, message) {
  try {
    await fn();
    console.error(`❌ FALLO: ${message} (no tiró error)`);
    process.exitCode = 1;
    return null;
  } catch (error) {
    console.log(`✅ ${message}`);
    return error;
  }
}

async function main() {
  const { store: adminStore, user: adminUser } = await createTestUser('ADMINISTRADOR');

  try {
    const sistemaFakeUser = { role: 'SISTEMA', isSistema: true, storeId: null };
    const adminFakeUser = { role: 'ADMINISTRADOR', isSistema: false, storeId: adminStore.id };

    // ═══════════════════════════════════════════════════════════
    // CASO 1: SISTEMA manda string "75" -> se persiste como número 75
    // ═══════════════════════════════════════════════════════════
    console.log('\n--- CASO 1: SISTEMA escribe maxDiscountPct = "75" (string) ---');
    const afterValidString = await storesServices.update(
      adminStore.id,
      { maxDiscountPct: '75' },
      sistemaFakeUser
    );
    assert(afterValidString.maxDiscountPct === 75, 'maxDiscountPct persiste como 75');
    assert(typeof afterValidString.maxDiscountPct === 'number', 'maxDiscountPct persiste como number, no string');

    // ═══════════════════════════════════════════════════════════
    // CASO 2: fuera de rango (> 100) -> rechazado con 400, no 403
    // ═══════════════════════════════════════════════════════════
    console.log('\n--- CASO 2: SISTEMA escribe maxDiscountPct = "150" (fuera de rango) ---');
    const errOutOfRange = await assertThrows(
      () => storesServices.update(adminStore.id, { maxDiscountPct: '150' }, sistemaFakeUser),
      'maxDiscountPct = "150" tira error'
    );
    if (errOutOfRange) {
      assert(errOutOfRange.status === 400, 'error de rango tiene status 400 (no 403)');
      assert(errOutOfRange.code === 'INVALID_MAX_DISCOUNT_PCT', 'error de rango tiene code INVALID_MAX_DISCOUNT_PCT');
    }

    // ═══════════════════════════════════════════════════════════
    // CASO 3: no numérico -> rechazado con 400, no PrismaClientValidationError
    // ═══════════════════════════════════════════════════════════
    console.log('\n--- CASO 3: SISTEMA escribe maxDiscountPct = "abc" (no numérico) ---');
    const errNonNumeric = await assertThrows(
      () => storesServices.update(adminStore.id, { maxDiscountPct: 'abc' }, sistemaFakeUser),
      'maxDiscountPct = "abc" tira error'
    );
    if (errNonNumeric) {
      assert(errNonNumeric.status === 400, 'error no-numérico tiene status 400');
    }

    // El store debe seguir en 75 (los dos intentos inválidos no debieron tocar nada)
    const afterInvalidAttempts = await storesServices.getById(adminStore.id, sistemaFakeUser);
    assert(afterInvalidAttempts.maxDiscountPct === 75, 'intentos inválidos no modificaron el valor ya guardado (sigue en 75)');

    // ═══════════════════════════════════════════════════════════
    // CASO 4: no-SISTEMA no puede tocar el campo (ya filtrado antes de validar)
    // ═══════════════════════════════════════════════════════════
    console.log('\n--- CASO 4: ADMINISTRADOR intenta escribir maxDiscountPct ---');
    const afterAdminWrite = await storesServices.update(
      adminStore.id,
      { maxDiscountPct: '10', name: adminStore.name },
      adminFakeUser
    );
    assert(afterAdminWrite.maxDiscountPct === 75, 'ADMINISTRADOR: maxDiscountPct NO cambia (sigue en 75)');
  } finally {
    await cleanupTestUser({ store: adminStore, user: adminUser });
  }

  if (process.exitCode === 1) {
    console.error('\n❌ Algunas aserciones de store-max-discount-pct.test.js fallaron.');
    process.exit(1);
  }
  console.log('\n✅ Todos los tests de store-max-discount-pct.test.js pasaron.');
}

if (require.main === module) {
  main().catch((err) => {
    console.error('❌ FALLO INESPERADO en store-max-discount-pct.test.js:', err.message);
    process.exit(1);
  });
}

module.exports = main;
