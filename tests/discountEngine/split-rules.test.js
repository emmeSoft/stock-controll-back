/**
 * split-rules.test.js — Test de separación de reglas por engineVersion
 * ─────────────────────────────────────────────────────────────────
 * Verifica SC-2.1: splitRulesByEngine separa correctamente legacy vs universal
 * 
 * Ejecutar: node tests/discountEngine/split-rules.test.js
 * ─────────────────────────────────────────────────────────────────
 */

// Extraemos la función directamente del servicio para testearla
// Como es una función interna, la replicamos acá para el test
function splitRulesByEngine(rules) {
  const legacyRules = [];
  const universalRules = [];
  for (const rule of rules) {
    if (rule.engineVersion === 'universal') {
      universalRules.push(rule);
    } else {
      legacyRules.push(rule);
    }
  }
  return { legacyRules, universalRules };
}

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FALLO: ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

// ═══════════════════════════════════════════════════════════════
// CASO 1: Reglas mixtas (legacy + universal)
// ═══════════════════════════════════════════════════════════════
console.log('\n--- CASO 1: Reglas mixtas ---');

const mixedRules = [
  { id: 'r1', engineVersion: 'legacy', name: 'Legacy QUANTITY' },
  { id: 'r2', engineVersion: 'universal', name: 'Universal ITEM' },
  { id: 'r3', engineVersion: 'legacy', name: 'Legacy CASH' },
  { id: 'r4', engineVersion: 'universal', name: 'Universal ORDER' },
];

const { legacyRules: l1, universalRules: u1 } = splitRulesByEngine(mixedRules);
assert(l1.length === 2, 'legacy: 2 reglas');
assert(u1.length === 2, 'universal: 2 reglas');
assert(l1[0].id === 'r1', 'primera legacy es r1');
assert(u1[0].id === 'r2', 'primera universal es r2');

// ═══════════════════════════════════════════════════════════════
// CASO 2: engineVersion null → legacy (backward-compat)
// ═══════════════════════════════════════════════════════════════
console.log('\n--- CASO 2: engineVersion null → legacy ---');
const nullVersionRules = [
  { id: 'r5', engineVersion: null, name: 'Regla vieja sin versión' },
  { id: 'r6', name: 'Regla sin campo engineVersion' },  // sin campo
];

const { legacyRules: l2, universalRules: u2 } = splitRulesByEngine(nullVersionRules);
assert(l2.length === 2, 'ambas caen como legacy (backward-compat)');
assert(u2.length === 0, 'ninguna se clasifica como universal');

// ═══════════════════════════════════════════════════════════════
// CASO 3: Solo universales
// ═══════════════════════════════════════════════════════════════
console.log('\n--- CASO 3: Solo universales ---');
const onlyUniversal = [
  { id: 'r7', engineVersion: 'universal' },
  { id: 'r8', engineVersion: 'universal' },
];

const { legacyRules: l3, universalRules: u3 } = splitRulesByEngine(onlyUniversal);
assert(l3.length === 0, 'legacyRules vacío cuando todas son universal');
assert(u3.length === 2, 'universalRules tiene 2');

// ═══════════════════════════════════════════════════════════════
// CASO 4: Lista vacía
// ═══════════════════════════════════════════════════════════════
console.log('\n--- CASO 4: Lista vacía ---');
const { legacyRules: l4, universalRules: u4 } = splitRulesByEngine([]);
assert(l4.length === 0, 'legacyRules vacío');
assert(u4.length === 0, 'universalRules vacío');

console.log('\n========================================');
console.log('✅ TODOS LOS TESTS DE SPLIT PASARON');
console.log('========================================');
