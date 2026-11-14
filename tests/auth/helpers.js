/**
 * helpers.js — Fixtures compartidos por tests/auth/*.test.js (DB-backed).
 * No se registra en tests/run-all.js: solo lo importan los tests hermanos.
 */
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();
const TEST_PASSWORD = 'AuthTest123!';

async function createTestUser(roleName, overrides = {}) {
  const role = await prisma.role.findFirst({ where: { name: roleName } });
  if (!role) throw new Error(`No existe el Role "${roleName}" — correr \`node prisma/seedRbac.js\` primero.`);

  const store = await prisma.store.create({ data: { name: `__auth_test_${roleName}_${Date.now()}__` } });

  const user = await prisma.user.create({
    data: {
      store: { connect: { id: store.id } },
      email: `auth-${roleName.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`,
      password: await bcrypt.hash(TEST_PASSWORD, 10),
      firstName: 'Test',
      lastName: 'User',
      phoneNumber: '000',
      address: 'Test',
      city: 'Test',
      mustChangePassword: false,
      rbacRole: { connect: { id: role.id } },
      ...overrides,
    },
    include: { rbacRole: true, store: true },
  });

  return { store, user };
}

async function cleanupTestUser({ store, user }) {
  await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
  await prisma.store.delete({ where: { id: store.id } }).catch(() => {});
}

function fakeRes() {
  return {
    statusCode: 200,
    cookieCalled: false,
    clearCookieCalled: false,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    cookie() { this.cookieCalled = true; return this; },
    clearCookie() { this.clearCookieCalled = true; return this; },
  };
}

module.exports = { prisma, TEST_PASSWORD, createTestUser, cleanupTestUser, fakeRes };
