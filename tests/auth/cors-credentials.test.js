/**
 * cors-credentials.test.js — Confirma que el CORS ya no negocia credenciales
 * (sin cookie de sesión, no hace falta `Access-Control-Allow-Credentials`).
 * Levanta el `app` real (index.js) en un puerto efímero y hace un request
 * HTTP real con header Origin, sin DB.
 *
 * Ejecutar con: node tests/auth/cors-credentials.test.js
 * ─────────────────────────────────────────────────────────────────
 */

const app = require('../../index');

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FALLO: ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`✅ ${message}`);
  }
}

async function main() {
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const port = server.address().port;

  try {
    const res = await fetch(`http://localhost:${port}/api/auth/check`, {
      headers: { Origin: 'http://localhost:5173' },
    });

    assert(
      res.headers.get('access-control-allow-origin') === 'http://localhost:5173',
      'CORS: origen permitido recibe Access-Control-Allow-Origin'
    );
    assert(
      res.headers.get('access-control-allow-credentials') === null,
      'CORS: no manda Access-Control-Allow-Credentials (no quedan cookies que negociar)'
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  if (process.exitCode === 1) {
    console.error('\n❌ Algunas aserciones de cors-credentials.test.js fallaron.');
    process.exit(1);
  }
  console.log('\n✅ Todos los tests de cors-credentials.test.js pasaron.');
}

if (require.main === module) {
  main().catch((err) => {
    console.error('❌ FALLO INESPERADO en cors-credentials.test.js:', err.message);
    process.exit(1);
  });
}

module.exports = main;
