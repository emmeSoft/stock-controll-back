/**
 * auth-token.test.js — Tests de signAuthToken / signSudoToken / verifySudoToken
 * (services/authServices.js). JWT puro: sin DB, sin fixtures.
 *
 * Ejecutar con: node tests/auth/auth-token.test.js
 * ─────────────────────────────────────────────────────────────────
 */

require('dotenv').config();
const jwt = require('jsonwebtoken');
const { signAuthToken, signSudoToken, verifySudoToken } = require('../../services/authServices');

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FALLO: ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

const fakeUser = { id: 'user-1', email: 'a@test.local', storeId: 'store-1', rbacRole: { name: 'VENDEDOR' } };

// ═══════════════════════════════════════════════════════════════
// CASO 1: signAuthToken — expira en 5h, claims correctos
// ═══════════════════════════════════════════════════════════════
console.log('\n--- CASO 1: signAuthToken ---');

const authToken = signAuthToken(fakeUser);
const decodedAuth = jwt.verify(authToken, process.env.JWT_SECRET);

assert(decodedAuth.id === fakeUser.id, 'signAuthToken: claim id correcto');
assert(decodedAuth.email === fakeUser.email, 'signAuthToken: claim email correcto');
assert(decodedAuth.role === 'VENDEDOR', 'signAuthToken: claim role correcto');
assert(decodedAuth.storeId === fakeUser.storeId, 'signAuthToken: claim storeId correcto');
assert(decodedAuth.exp - decodedAuth.iat === 5 * 60 * 60, 'signAuthToken: expira en 5h (18000s)');

// ═══════════════════════════════════════════════════════════════
// CASO 2: signSudoToken — 2 min, purpose 'sudo'
// ═══════════════════════════════════════════════════════════════
console.log('\n--- CASO 2: signSudoToken ---');

const sudoToken = signSudoToken(fakeUser.id);
const decodedSudo = jwt.verify(sudoToken, process.env.JWT_SECRET);

assert(decodedSudo.id === fakeUser.id, 'signSudoToken: claim id correcto');
assert(decodedSudo.purpose === 'sudo', "signSudoToken: claim purpose === 'sudo'");
assert(decodedSudo.exp - decodedSudo.iat === 2 * 60, 'signSudoToken: expira en 2min (120s)');

// ═══════════════════════════════════════════════════════════════
// CASO 3: verifySudoToken — round-trip y rechazo de token inválido
// ═══════════════════════════════════════════════════════════════
console.log('\n--- CASO 3: verifySudoToken ---');

const roundTripped = verifySudoToken(sudoToken);
assert(roundTripped.id === fakeUser.id, 'verifySudoToken: round-trip conserva id');
assert(roundTripped.purpose === 'sudo', 'verifySudoToken: round-trip conserva purpose');

let threw = false;
try {
  verifySudoToken('not-a-valid-jwt');
} catch (e) {
  threw = true;
}
assert(threw, 'verifySudoToken: token inválido lanza');

console.log('\n✅ Todos los tests de auth-token.js pasaron.');
