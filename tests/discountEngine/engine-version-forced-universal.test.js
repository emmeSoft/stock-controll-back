/**
 * engine-version-forced-universal.test.js
 * ─────────────────────────────────────────────────────────────────
 * Regresión: reemplaza a legacy-pipeline-arity.test.js.
 *
 * Contexto: el motor "legacy" nunca tuvo una implementación real en este
 * código base — `discountEngine/index.js` alias-ea `runPipeline` directo a
 * `runUniversalPipeline`, que SIEMPRE filtra por `engineVersion ===
 * 'universal'` antes de evaluar nada. El fix anterior (pasar
 * `legacyContext.rules` como segundo argumento) solo arreglaba el crash por
 * arity, pero dejaba un bug peor: cualquier regla legacy activa producía un
 * descuento $0 SILENCIOSO (el filtro vacía `legacyRules` siempre), en vez de
 * explotar fuerte. Decisión: retirar la rama legacy por completo en
 * `discountService.js` / `salesServices.js` — ya no existe ningún call site
 * que llame a `runPipeline`/`runUniversalPipeline` con reglas no-universales.
 *
 * Este test cubre la defensa que reemplaza a esa rama: una DiscountRule
 * JAMÁS puede crearse/editarse con `engineVersion` distinto de 'universal',
 * sin importar qué mande el cliente — y una vez forzado a 'universal', el
 * body debe tener la forma universal real (`conditionsUniversal`), no la
 * forma legacy (`type` + `conditions`), para no terminar persistiendo una
 * regla "universal" sin condiciones que el motor nunca ejecute.
 *
 * `sanitizeRuleInput` y `validateRuleBody` son funciones internas de
 * `services/discountService.js` (no exportadas) — siguiendo la convención
 * ya usada en split-rules.test.js / crud-universal.test.js / preview-merge.test.js,
 * se replican acá para testearlas aisladas, en sincronía con la
 * implementación real.
 *
 * Ejecutar: node tests/discountEngine/engine-version-forced-universal.test.js
 * ─────────────────────────────────────────────────────────────────
 */

const { validateConditionsDual } = require('../../services/discountEngine/validators');

// Réplica de services/discountService.js::sanitizeRuleInput (post-fix).
function sanitizeRuleInput(body) {
  const {
    name, description,
    type, percentage,
    startsAt, endsAt,
    conditions,
    conditionsUniversal,
    priority,
    isCombinable,
    allowPartial,
    combinesWith,
    maxPercentage,
  } = body;
  return {
    name, description,
    type: type ?? null,
    percentage,
    startsAt: startsAt ? new Date(startsAt) : null,
    endsAt: endsAt ? new Date(endsAt) : null,
    conditions: conditions ?? null,
    conditionsUniversal: conditionsUniversal ?? null,
    engineVersion: 'universal', // forzado server-side, SIEMPRE
    priority: priority ?? 0,
    isCombinable: isCombinable ?? true,
    allowPartial: allowPartial ?? false,
    combinesWith: combinesWith ?? [],
    maxPercentage: maxPercentage ?? null,
  };
}

// Réplica de services/discountService.js::validateRuleBody (post-fix).
function validateRuleBody({ percentage, conditionsUniversal }) {
  if (typeof percentage !== 'number' || percentage <= 0 || percentage >= 100) {
    throw new Error('`percentage` debe ser un número entre 0.01 y 99.99.');
  }
  if (!conditionsUniversal || typeof conditionsUniversal !== 'object') {
    throw new Error('`conditionsUniversal` debe ser un objeto para reglas universales.');
  }
  const condError = validateConditionsDual(conditionsUniversal, 'universal');
  if (condError) throw new Error(`conditionsUniversal inválidas: ${condError}`);
}

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FALLO: ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

function assertThrows(fn, label) {
  try {
    fn();
    console.error(`❌ FALLO: ${label} — debería haber lanzado error`);
    process.exit(1);
  } catch (err) {
    console.log(`✅ ${label} — lanzó error esperado: "${err.message}"`);
  }
}

// ═══════════════════════════════════════════════════════════════
// CASO 1: sanitizeRuleInput fuerza 'universal' sin importar lo que
// mande el cliente.
// ═══════════════════════════════════════════════════════════════
console.log("\n--- CASO 1: sanitizeRuleInput ignora engineVersion del cliente ---");

const clientPayloads = [
  { label: "engineVersion: 'legacy'", body: { engineVersion: 'legacy', percentage: 10 } },
  { label: 'engineVersion: null', body: { engineVersion: null, percentage: 10 } },
  { label: 'engineVersion ausente', body: { percentage: 10 } },
  { label: "engineVersion: 'universal' (coincide)", body: { engineVersion: 'universal', percentage: 10 } },
  { label: "engineVersion: 'inventado-por-el-cliente'", body: { engineVersion: 'inventado-por-el-cliente', percentage: 10 } },
];

for (const { label, body } of clientPayloads) {
  const sanitized = sanitizeRuleInput(body);
  assert(sanitized.engineVersion === 'universal', `${label} → engineVersion resultante es 'universal'`);
}

// ═══════════════════════════════════════════════════════════════
// CASO 2: validateRuleBody rechaza un body con forma legacy (type +
// conditions, sin conditionsUniversal) aunque el cliente mande
// engineVersion: 'legacy' — este es exactamente el hueco que dejaba
// la validación dual: antes era aceptado como legacy válido y
// terminaba persistido como 'universal' sin conditionsUniversal
// (regla fantasma que el motor nunca ejecuta).
// ═══════════════════════════════════════════════════════════════
console.log('\n--- CASO 2: body con forma legacy es rechazado ---');

assertThrows(
  () => validateRuleBody({
    engineVersion: 'legacy',
    type: 'CASH_PAYMENT',
    percentage: 10,
    conditions: { paymentMethods: ['CASH'] }, // forma legacy, sin conditionsUniversal
  }),
  'Body con forma legacy (sin conditionsUniversal) lanza error'
);

assertThrows(
  () => validateRuleBody({
    // engineVersion ausente — antes caía al branch legacy y se aceptaba
    percentage: 10,
    conditions: { paymentMethods: ['CASH'] },
  }),
  'Body sin engineVersion ni conditionsUniversal lanza error'
);

// ═══════════════════════════════════════════════════════════════
// CASO 3: validateRuleBody acepta un body universal real.
// ═══════════════════════════════════════════════════════════════
console.log('\n--- CASO 3: body universal válido es aceptado ---');

let threw = false;
try {
  validateRuleBody({
    percentage: 15,
    conditionsUniversal: {
      target: { productIds: ['p1'] },
    },
  });
} catch (err) {
  threw = true;
  console.error(`❌ FALLO: lanzó error inesperado: ${err.message}`);
}
assert(!threw, 'Body universal válido no lanza error');

// ═══════════════════════════════════════════════════════════════
// CASO 4: percentage sigue validado igual que antes.
// ═══════════════════════════════════════════════════════════════
console.log('\n--- CASO 4: percentage fuera de rango sigue rechazado ---');

assertThrows(
  () => validateRuleBody({ percentage: 150, conditionsUniversal: { target: { productIds: ['p1'] } } }),
  'percentage > 100 lanza error'
);

console.log('\n========================================');
console.log('✅ TODOS LOS TESTS DE engineVersion FORZADO A UNIVERSAL PASARON');
console.log('========================================');
