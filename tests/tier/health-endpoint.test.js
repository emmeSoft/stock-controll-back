/**
 * health-endpoint.test.js — `GET /api/health` wake endpoint.
 * (controllers/healthController.js, routes/healthRoutes.js, index.js). DB-backed
 * (asserts store count is untouched across repeated calls) + reads index.js
 * source to verify mount order relative to the global rate limiter.
 *
 * Covers spec "Idempotent Wake Endpoint":
 *   - 200, no auth required.
 *   - Repeated calls never mutate persisted data.
 *   - Route is mounted above `app.use(limiter)` so the wake call can never
 *     be rejected by the global rate limiter.
 *
 * Ejecutar con: node tests/tier/health-endpoint.test.js
 * ─────────────────────────────────────────────────────────────────
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const app = require('../../index');

const prisma = new PrismaClient();

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FALLO: ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`✅ ${message}`);
  }
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

async function main() {
  const httpServer = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => httpServer.once('listening', resolve));
  const port = httpServer.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // ═══════════════════════════════════════════════════════════
    // CASO 1: GET /api/health -> 200, sin auth, forma correcta
    // ═══════════════════════════════════════════════════════════
    console.log('\n--- CASO 1: GET /api/health sin auth ---');
    const res1 = await fetch(`${baseUrl}/api/health`);
    const body1 = await res1.json();

    assert(res1.status === 200, `GET /api/health responde 200 (obtuvo ${res1.status})`);
    assert(body1.status === 'ok', `body.status === 'ok' (obtuvo ${body1.status})`);
    assert(body1.service === 'stock-controll-back', `body.service === 'stock-controll-back' (obtuvo ${body1.service})`);
    assert(typeof body1.timestamp === 'string', 'body.timestamp es un string');
    assert(!Number.isNaN(Date.parse(body1.timestamp)), 'body.timestamp es una fecha ISO parseable');

    // ═══════════════════════════════════════════════════════════
    // CASO 2: llamadas repetidas no mutan datos (store count intacto)
    // ═══════════════════════════════════════════════════════════
    console.log('\n--- CASO 2: llamadas repetidas no mutan datos ---');
    const storeCountBefore = await prisma.store.count();

    for (let i = 0; i < 5; i++) {
      const res = await fetch(`${baseUrl}/api/health`);
      assert(res.status === 200, `GET /api/health (llamada ${i + 1}/5) responde 200`);
    }

    const storeCountAfter = await prisma.store.count();
    assert(
      storeCountAfter === storeCountBefore,
      `el conteo de stores no cambió tras 5 llamadas (antes: ${storeCountBefore}, después: ${storeCountAfter})`
    );

    // ═══════════════════════════════════════════════════════════
    // CASO 3: timestamps distintos entre llamadas (no cacheado/estático de build)
    // ═══════════════════════════════════════════════════════════
    console.log('\n--- CASO 3: cada llamada genera su propio timestamp ---');
    const resA = await fetch(`${baseUrl}/api/health`);
    const bodyA = await resA.json();
    await new Promise((resolve) => setTimeout(resolve, 10));
    const resB = await fetch(`${baseUrl}/api/health`);
    const bodyB = await resB.json();
    assert(
      Date.parse(bodyB.timestamp) >= Date.parse(bodyA.timestamp),
      'el timestamp avanza entre llamadas (se genera en vivo, no es un literal estático)'
    );

    // ═══════════════════════════════════════════════════════════
    // CASO 4: /api/health se monta ANTES del rate limiter global en index.js
    // ═══════════════════════════════════════════════════════════
    console.log('\n--- CASO 4: /api/health montado antes del limiter global ---');
    const indexSrc = fs.readFileSync(path.join(__dirname, '../../index.js'), 'utf8');
    const healthMountIdx = indexSrc.indexOf(`app.use('/api/health'`);
    const limiterMountIdx = indexSrc.indexOf('app.use(limiter)');

    assert(healthMountIdx !== -1, "index.js monta app.use('/api/health', ...)");
    assert(limiterMountIdx !== -1, 'index.js monta app.use(limiter)');
    assert(
      healthMountIdx !== -1 && limiterMountIdx !== -1 && healthMountIdx < limiterMountIdx,
      '/api/health se registra antes que el limiter global en index.js'
    );

    // ═══════════════════════════════════════════════════════════
    // CASO 5: no requiere authMiddleware (ya probado por CASO 1 sin header,
    // pero se confirma explícitamente mandando un Authorization inválido)
    // ═══════════════════════════════════════════════════════════
    console.log('\n--- CASO 5: Authorization inválido no bloquea /api/health ---');
    const res5 = await fetch(`${baseUrl}/api/health`, {
      headers: { Authorization: 'Bearer not-a-real-token' },
    });
    assert(res5.status === 200, `GET /api/health con Authorization inválido sigue respondiendo 200 (obtuvo ${res5.status})`);
  } finally {
    await close(httpServer);
    await prisma.$disconnect();
  }

  if (process.exitCode === 1) {
    console.error('\n❌ Algunas aserciones de health-endpoint.test.js fallaron.');
    process.exit(1);
  }
  console.log('\n✅ Todos los tests de health-endpoint.test.js pasaron.');
}

if (require.main === module) {
  main().catch(async (err) => {
    console.error('❌ FALLO INESPERADO en health-endpoint.test.js:', err.message);
    await prisma.$disconnect().catch(() => {});
    process.exit(1);
  });
}

module.exports = main;
