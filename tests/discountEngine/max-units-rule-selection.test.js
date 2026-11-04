/**
 * max-units-rule-selection.test.js
 * ─────────────────────────────────────────────────────────────────
 * Cubre el fix de `simulateMonetaryImpact` (services/discountEngine/universal/calculator.js):
 * antes ignoraba `constraints.maxUnits` al simular el impacto de una regla para
 * fines de SELECCIÓN (qué regla "gana" cuando dos compiten por el mismo item),
 * asumiendo que el descuento cubría TODAS las unidades del item aunque la regla
 * topeara a menos. Eso podía hacer ganar a una regla que en los hechos
 * (applyDiscount) descuenta menos que la otra.
 *
 * Caso real verificado a mano durante el desarrollo: item qty=10 @ $100
 * (originalSubtotal $1000) con dos reglas en competencia:
 *   - Regla A: 50% con maxUnits=2  → antes: impacto simulado $500 (ganaba)
 *                                     ahora: impacto simulado $100 (correcto)
 *   - Regla B: 20% sin tope        → impacto $200 (siempre correcto)
 * Con el fix, B gana (200 > 100). Sin el fix, A ganaba (500 > 200) — la
 * regla equivocada.
 *
 * Usa las funciones REALES exportadas por calculator.js (no se replica).
 *
 * Ejecutar: node tests/discountEngine/max-units-rule-selection.test.js
 * ─────────────────────────────────────────────────────────────────
 */

const { simulateMonetaryImpact, findBestItemRule } = require('../../services/discountEngine/universal/calculator');

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FALLO: ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

const item = { productId: 'p1', categoryId: 'c1', quantity: 10, unitPrice: 100 };

const ruleA = { id: 'rule-a', percentage: 50, conditionsUniversal: { constraints: { maxUnits: 2 } } };
const ruleB = { id: 'rule-b', percentage: 20, conditionsUniversal: {} };

console.log('\n--- CASO: simulateMonetaryImpact respeta maxUnits al simular ---');

const impactA = simulateMonetaryImpact(ruleA, item);
const impactB = simulateMonetaryImpact(ruleB, item);

assert(impactA === 100, `Regla A (50%, maxUnits=2) simula $100 sobre 2 unidades (obtuvo ${impactA})`);
assert(impactB === 200, `Regla B (20%, sin tope) simula $200 sobre 10 unidades (obtuvo ${impactB})`);

console.log('\n--- CASO: findBestItemRule elige la regla de mayor impacto REAL, no la de mayor % nominal ---');

const winner = findBestItemRule([ruleA, ruleB], item);

assert(winner !== null, 'Se eligió una regla ganadora');
assert(winner.id === 'rule-b', `Regla B gana ($200 > $100) aunque la Regla A tenga mayor % nominal (ganadora obtenida: ${winner?.id})`);

console.log('\n========================================');
console.log('✅ TODOS LOS TESTS DE maxUnits (selección de regla) PASARON');
console.log('========================================');
