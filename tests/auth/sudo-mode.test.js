/**
 * sudo-mode.test.js — `verifySudo` (controller) + `verifySudoMode` (service)
 * (controllers/authController.js, services/employeeServices.js). DB-backed.
 *
 * Ejecutar con: node tests/auth/sudo-mode.test.js
 * ─────────────────────────────────────────────────────────────────
 */

const jwt = require('jsonwebtoken');
const authController = require('../../controllers/authController');
const { verifySudoMode } = require('../../services/employeeServices');
const { signSudoToken } = require('../../services/authServices');
const { createTestUser, cleanupTestUser, fakeRes, TEST_PASSWORD } = require('./helpers');

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FALLO: ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`✅ ${message}`);
  }
}

function throws(fn, message) {
  try {
    fn();
    console.error(`❌ FALLO: ${message} (no lanzó)`);
    process.exitCode = 1;
  } catch (e) {
    console.log(`✅ ${message}`);
  }
}

function doesNotThrow(fn, message) {
  fn();
  console.log(`✅ ${message}`);
}

async function main() {
  const { store: adminStore, user: admin } = await createTestUser('ADMINISTRADOR');
  const { store: sellerStore, user: seller } = await createTestUser('VENDEDOR');

  try {
    console.log('\n--- verifySudo: rol no privilegiado -> 403, antes de cualquier compare de contraseña (HIGH-004) ---');
    const roleRejectRes = fakeRes();
    await authController.verifySudo(
      { user: { id: 'no-existe-en-la-db', rbacRole: 'VENDEDOR' }, body: { password: 'cualquiera' } },
      roleRejectRes
    );
    // Si el rol se chequeara DESPUÉS del password, 'no-existe-en-la-db' daría 404 (admin no encontrado), no 403.
    assert(roleRejectRes.statusCode === 403, 'verifySudo: rol VENDEDOR -> 403 sin llegar a buscar el admin en la DB');

    console.log('\n--- verifySudo: password correcto -> sudoToken en el body, sin Set-Cookie ---');
    const sudoRes = fakeRes();
    await authController.verifySudo(
      { user: { id: admin.id, rbacRole: 'ADMINISTRADOR' }, body: { password: TEST_PASSWORD } },
      sudoRes
    );
    assert(typeof sudoRes.body.sudoToken === 'string', 'verifySudo: body.sudoToken es un string');
    assert(!sudoRes.cookieCalled, 'verifySudo: no llama a res.cookie');

    console.log('\n--- verifySudoMode: matriz de aceptación/rechazo ---');
    const validSudoToken = sudoRes.body.sudoToken;
    const malformedToken = 'not-a-jwt';
    const expiredToken = jwt.sign({ id: admin.id, purpose: 'sudo' }, process.env.JWT_SECRET, { expiresIn: '-10s' });
    const wrongPurposeToken = jwt.sign({ id: admin.id, purpose: 'password-setup' }, process.env.JWT_SECRET, { expiresIn: '2m' });
    const otherUsersToken = signSudoToken(seller.id);

    doesNotThrow(
      () => verifySudoMode({ headers: { 'x-sudo-token': validSudoToken }, user: { id: admin.id } }),
      'verifySudoMode: token válido del propio usuario -> permite'
    );
    throws(
      () => verifySudoMode({ headers: {}, user: { id: admin.id } }),
      'verifySudoMode: header ausente -> deniega'
    );
    throws(
      () => verifySudoMode({ headers: { 'x-sudo-token': malformedToken }, user: { id: admin.id } }),
      'verifySudoMode: token malformado -> deniega'
    );
    throws(
      () => verifySudoMode({ headers: { 'x-sudo-token': expiredToken }, user: { id: admin.id } }),
      'verifySudoMode: token expirado -> deniega'
    );
    throws(
      () => verifySudoMode({ headers: { 'x-sudo-token': wrongPurposeToken }, user: { id: admin.id } }),
      "verifySudoMode: purpose !== 'sudo' -> deniega"
    );
    throws(
      () => verifySudoMode({ headers: { 'x-sudo-token': otherUsersToken }, user: { id: admin.id } }),
      'verifySudoMode: token sudo de otro usuario -> deniega (decoded.id !== req.user.id)'
    );

    console.log('\n--- logout: 200, sin clearCookie ---');
    const logoutRes = fakeRes();
    await authController.logout({}, logoutRes);
    assert(logoutRes.statusCode === 200, 'logout: responde 200');
    assert(!logoutRes.clearCookieCalled, 'logout: no llama a res.clearCookie');
  } finally {
    await cleanupTestUser({ store: adminStore, user: admin });
    await cleanupTestUser({ store: sellerStore, user: seller });
  }

  if (process.exitCode === 1) {
    console.error('\n❌ Algunas aserciones de sudo-mode.test.js fallaron.');
    process.exit(1);
  }
  console.log('\n✅ Todos los tests de sudo-mode.test.js pasaron.');
}

if (require.main === module) {
  main().catch((err) => {
    console.error('❌ FALLO INESPERADO en sudo-mode.test.js:', err.message);
    process.exit(1);
  });
}

module.exports = main;
