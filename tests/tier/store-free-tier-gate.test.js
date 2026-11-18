/**
 * store-free-tier-gate.test.js — `isFreeTier` SISTEMA-only gate + payload exposure.
 * (services/storesServices.js, services/authServices.js, controllers/authController.js). DB-backed.
 *
 * Covers spec "SISTEMA-Only Tier Flag":
 *   - SISTEMA write persists `isFreeTier` (Boolean, with string coercion).
 *   - Non-SISTEMA write attempt is silently dropped, value unchanged.
 *   - `buildUserPayload` exposes `isFreeTier` (+ `lastName`) for both the
 *     `login` shape and the unified `checkAuth` shape.
 *
 * Ejecutar con: node tests/tier/store-free-tier-gate.test.js
 * ─────────────────────────────────────────────────────────────────
 */

require('dotenv').config();
const storesServices = require('../../services/storesServices');
const authServices = require('../../services/authServices');
const authController = require('../../controllers/authController');
const { createTestUser, cleanupTestUser, fakeRes, TEST_PASSWORD, prisma } = require('../auth/helpers');

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FALLO: ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`✅ ${message}`);
  }
}

async function main() {
  const { store: adminStore, user: adminUser } = await createTestUser('ADMINISTRADOR');
  const { store: sistemaStore, user: sistemaUser } = await createTestUser('SISTEMA');

  try {
    // ═══════════════════════════════════════════════════════════
    // CASO 1: nuevo store default a isFreeTier = true
    // ═══════════════════════════════════════════════════════════
    console.log('\n--- CASO 1: nuevo store default a isFreeTier = true ---');
    assert(adminStore.isFreeTier === true, 'store nuevo: isFreeTier default es true');

    // ═══════════════════════════════════════════════════════════
    // CASO 2: no-SISTEMA intenta escribir isFreeTier -> se descarta
    // ═══════════════════════════════════════════════════════════
    console.log('\n--- CASO 2: ADMINISTRADOR intenta escribir isFreeTier ---');
    const adminFakeUser = { role: 'ADMINISTRADOR', isSistema: false, storeId: adminStore.id };
    const afterAdminWrite = await storesServices.update(
      adminStore.id,
      { isFreeTier: false, name: adminStore.name },
      adminFakeUser
    );
    assert(afterAdminWrite.isFreeTier === true, 'ADMINISTRADOR: isFreeTier NO cambia (sigue en true)');

    // ═══════════════════════════════════════════════════════════
    // CASO 3: SISTEMA escribe isFreeTier (boolean real)
    // ═══════════════════════════════════════════════════════════
    console.log('\n--- CASO 3: SISTEMA escribe isFreeTier = false (boolean) ---');
    const sistemaFakeUser = { role: 'SISTEMA', isSistema: true, storeId: null };
    const afterSistemaWriteBool = await storesServices.update(
      adminStore.id,
      { isFreeTier: false },
      sistemaFakeUser
    );
    assert(afterSistemaWriteBool.isFreeTier === false, 'SISTEMA: isFreeTier boolean false persiste');

    // ═══════════════════════════════════════════════════════════
    // CASO 4: SISTEMA escribe isFreeTier con string "true" -> coerción
    // ═══════════════════════════════════════════════════════════
    console.log('\n--- CASO 4: SISTEMA escribe isFreeTier = "true" (string, coerción) ---');
    const afterStringTrue = await storesServices.update(
      adminStore.id,
      { isFreeTier: 'true' },
      sistemaFakeUser
    );
    assert(afterStringTrue.isFreeTier === true, 'SISTEMA: string "true" coerciona a boolean true');
    assert(
      typeof afterStringTrue.isFreeTier === 'boolean',
      'SISTEMA: el valor persistido es un boolean real, no string'
    );

    // ═══════════════════════════════════════════════════════════
    // CASO 5: SISTEMA escribe isFreeTier con string "false" -> coerción
    // ═══════════════════════════════════════════════════════════
    console.log('\n--- CASO 5: SISTEMA escribe isFreeTier = "false" (string, coerción) ---');
    const afterStringFalse = await storesServices.update(
      adminStore.id,
      { isFreeTier: 'false' },
      sistemaFakeUser
    );
    assert(afterStringFalse.isFreeTier === false, 'SISTEMA: string "false" coerciona a boolean false');

    // Dejar el store en un estado conocido para los casos de payload.
    await prisma.store.update({ where: { id: adminStore.id }, data: { isFreeTier: true } });

    // ═══════════════════════════════════════════════════════════
    // CASO 6: buildUserPayload expone isFreeTier + lastName
    // ═══════════════════════════════════════════════════════════
    console.log('\n--- CASO 6: buildUserPayload expone isFreeTier + lastName ---');
    assert(
      typeof authServices.buildUserPayload === 'function',
      'authServices expone buildUserPayload'
    );

    if (typeof authServices.buildUserPayload === 'function') {
      const fakeDbUser = {
        id: 'u-1',
        firstName: 'Ana',
        lastName: 'Gómez',
        email: 'ana@test.local',
        rbacRole: { name: 'VENDEDOR' },
        storeId: adminStore.id,
        store: { name: adminStore.name, isFreeTier: true },
        profilePicture: null,
      };
      const payload = authServices.buildUserPayload(fakeDbUser);
      assert(payload.lastName === 'Gómez', 'buildUserPayload: incluye lastName');
      assert(payload.isFreeTier === true, 'buildUserPayload: incluye isFreeTier === true desde store');

      const fakeDbUserNoStore = { ...fakeDbUser, store: null };
      const payloadNoStore = authServices.buildUserPayload(fakeDbUserNoStore);
      assert(
        payloadNoStore.isFreeTier === true,
        'buildUserPayload: sin store (SISTEMA) default isFreeTier a true'
      );
    }

    // ═══════════════════════════════════════════════════════════
    // CASO 7: login expone isFreeTier en el payload de usuario
    // ═══════════════════════════════════════════════════════════
    console.log('\n--- CASO 7: login expone isFreeTier ---');
    const loginResult = await authServices.loginUser(adminUser.email, TEST_PASSWORD);
    assert(loginResult.user.isFreeTier === true, 'login: user.isFreeTier === true');
    assert(loginResult.user.lastName === adminUser.lastName, 'login: user.lastName presente');

    // ═══════════════════════════════════════════════════════════
    // CASO 8: checkAuth usa buildUserPayload (incluye store) y expone isFreeTier
    // ═══════════════════════════════════════════════════════════
    console.log('\n--- CASO 8: checkAuth expone isFreeTier vía buildUserPayload ---');
    const checkAuthRes = fakeRes();
    await authController.checkAuth({ user: { id: adminUser.id } }, checkAuthRes);
    assert(checkAuthRes.body.isFreeTier === true, 'checkAuth: body.isFreeTier === true');
    assert(checkAuthRes.body.lastName === adminUser.lastName, 'checkAuth: body.lastName presente (no regresiona)');
    assert(checkAuthRes.body.storeId === adminUser.storeId, 'checkAuth: body.storeId presente (no regresiona)');
  } finally {
    await cleanupTestUser({ store: adminStore, user: adminUser });
    await cleanupTestUser({ store: sistemaStore, user: sistemaUser });
  }

  if (process.exitCode === 1) {
    console.error('\n❌ Algunas aserciones de store-free-tier-gate.test.js fallaron.');
    process.exit(1);
  }
  console.log('\n✅ Todos los tests de store-free-tier-gate.test.js pasaron.');
}

if (require.main === module) {
  main().catch((err) => {
    console.error('❌ FALLO INESPERADO en store-free-tier-gate.test.js:', err.message);
    process.exit(1);
  });
}

module.exports = main;
