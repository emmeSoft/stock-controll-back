/**
 * auth-middleware.test.js — login/setupPassword body tokens (sin cookies) +
 * matriz de aceptación/rechazo de authMiddleware (header-only).
 * (controllers/authController.js, middlewares/authMiddleware.js). DB-backed.
 *
 * Ejecutar con: node tests/auth/auth-middleware.test.js
 * ─────────────────────────────────────────────────────────────────
 */

const jwt = require('jsonwebtoken');
const authController = require('../../controllers/authController');
const { authMiddleware } = require('../../middlewares/authMiddleware');
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

async function runMiddleware(req) {
  const res = fakeRes();
  let nextCalled = false;
  await authMiddleware(req, res, () => { nextCalled = true; });
  return { res, nextCalled };
}

async function main() {
  const { store, user } = await createTestUser('VENDEDOR');
  const { store: pendingStore, user: pendingUser } = await createTestUser('VENDEDOR', { mustChangePassword: true });

  try {
    console.log('\n--- login: body token, sin Set-Cookie ---');
    const loginRes = fakeRes();
    await authController.login({ body: { email: user.email, password: TEST_PASSWORD } }, loginRes);
    assert(typeof loginRes.body.token === 'string', 'login: body.token es un string');
    assert(!loginRes.cookieCalled, 'login: no llama a res.cookie');

    console.log('\n--- login (mustChangePassword): body setupToken, sin Set-Cookie ---');
    const setupLoginRes = fakeRes();
    await authController.login({ body: { email: pendingUser.email, password: TEST_PASSWORD } }, setupLoginRes);
    assert(typeof setupLoginRes.body.setupToken === 'string', 'login (pending): body.setupToken es un string');
    assert(!setupLoginRes.cookieCalled, 'login (pending): no llama a res.cookie');

    console.log('\n--- setupPassword: lee el header Bearer, no req.cookies ---');
    const setupToken = setupLoginRes.body.setupToken;
    const setupPasswordRes = fakeRes();
    await authController.setupPassword(
      { headers: { authorization: `Bearer ${setupToken}` }, cookies: {}, body: { newPassword: 'NuevaClave123!' } },
      setupPasswordRes
    );
    assert(typeof setupPasswordRes.body.token === 'string', 'setupPassword: body.token es un string vía header');
    assert(!setupPasswordRes.cookieCalled, 'setupPassword: no llama a res.cookie');

    const noHeaderRes = fakeRes();
    await authController.setupPassword({ headers: {}, cookies: {}, body: { newPassword: 'NuevaClave123!' } }, noHeaderRes);
    assert(noHeaderRes.statusCode === 401, 'setupPassword: sin Authorization header -> 401');

    console.log('\n--- authMiddleware: matriz de aceptación/rechazo ---');
    const validToken = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: '5h' });
    const expiredToken = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: '-10s' });
    const purposeToken = signSudoToken(user.id);

    {
      const { nextCalled } = await runMiddleware({ headers: { authorization: `Bearer ${validToken}` } });
      assert(nextCalled, 'authMiddleware: header Bearer válido autentica');
    }
    {
      const { res, nextCalled } = await runMiddleware({ headers: {} });
      assert(!nextCalled && res.statusCode === 401, 'authMiddleware: sin Authorization -> 401');
    }
    {
      const { res, nextCalled } = await runMiddleware({ headers: { authorization: 'Bearer not-a-jwt' } });
      assert(!nextCalled && res.statusCode === 401, 'authMiddleware: token malformado -> 401');
    }
    {
      const { res, nextCalled } = await runMiddleware({ headers: { authorization: `Bearer ${expiredToken}` } });
      assert(!nextCalled && res.statusCode === 401, 'authMiddleware: token expirado -> 401');
    }
    {
      const { res, nextCalled } = await runMiddleware({ headers: { authorization: `Bearer ${purposeToken}` } });
      assert(!nextCalled && res.statusCode === 401, 'authMiddleware: token con claim purpose -> 401 (no puede colarse como sesión)');
    }
    {
      const { res, nextCalled } = await runMiddleware({ cookies: { token: validToken }, headers: {} });
      assert(!nextCalled && res.statusCode === 401, 'authMiddleware: ya no lee req.cookies (cero fallback a cookie)');
    }
  } finally {
    await cleanupTestUser({ store, user });
    await cleanupTestUser({ store: pendingStore, user: pendingUser });
  }

  if (process.exitCode === 1) {
    console.error('\n❌ Algunas aserciones de auth-middleware.test.js fallaron.');
    process.exit(1);
  }
  console.log('\n✅ Todos los tests de auth-middleware.test.js pasaron.');
}

if (require.main === module) {
  main().catch((err) => {
    console.error('❌ FALLO INESPERADO en auth-middleware.test.js:', err.message);
    process.exit(1);
  });
}

module.exports = main;
