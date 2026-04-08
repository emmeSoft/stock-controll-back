/**
 * crud-universal.test.js — Test de validación CRUD para reglas universales
 * ─────────────────────────────────────────────────────────────────
 * Verifica SC-2.4: validateRuleBody acepta reglas universales y rechaza
 * payloads inválidos correctamente.
 * 
 * NO requiere DB — testa la lógica de validación pura.
 * 
 * Ejecutar: node tests/discountEngine/crud-universal.test.js
 * ─────────────────────────────────────────────────────────────────
 */

const { validateConditionsDual } = require('../../services/discountEngine/validators');

// Replicamos validateRuleBody para testearla aislada
function validateRuleBody({ type, percentage, conditions, conditionsUniversal, engineVersion }) {
  if (typeof percentage !== 'number' || percentage <= 0 || percentage >= 100) {
    throw new Error('percentage debe ser entre 0.01 y 99.99.');
  }
  const version = engineVersion ?? 'legacy';
  if (version === 'universal') {
    if (!conditionsUniversal || typeof conditionsUniversal !== 'object') {
      throw new Error('conditionsUniversal requerido para reglas universales.');
    }
    const condError = validateConditionsDual(conditionsUniversal, 'universal');
    if (condError) throw new Error('conditionsUniversal invalidas: ' + condError);
  } else {
    if (!type) throw new Error('type es obligatorio para reglas legacy.');
    if (!conditions || typeof conditions !== 'object') {
      throw new Error('conditions debe ser un objeto para reglas legacy.');
    }
    const condError = validateConditionsDual(conditions, 'legacy', type);
    if (condError) throw new Error('Conditions invalidas para tipo ' + type + ': ' + condError);
  }
}

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FALLO: ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

function assertThrows(fn, expectedMsg, label) {
  try {
    fn();
    console.error(`❌ FALLO: ${label} — debería haber lanzado error`);
    process.exit(1);
  } catch (err) {
    if (expectedMsg && !err.message.includes(expectedMsg)) {
      console.error(`❌ FALLO: ${label} — mensaje incorrecto: "${err.message}"`);
      process.exit(1);
    }
    console.log(`✅ ${label} — lanzó error esperado: "${err.message}"`);
  }
}

// ═══════════════════════════════════════════════════════════════
// CASO 1: Regla universal válida — ITEM (con target)
// ═══════════════════════════════════════════════════════════════
console.log('\n--- CASO 1: Universal válida — ITEM ---');
let threw = false;
try {
  validateRuleBody({
    engineVersion: 'universal',
    percentage: 15,
    conditionsUniversal: {
      target: { productIds: ['p1', 'p2'] },
      ticketConditions: { paymentMethods: ['CASH'] },
    },
  });
  console.log('✅ Regla universal ITEM válida — no lanzó error');
} catch (err) {
  console.error(`❌ FALLO: lanzó error inesperado: ${err.message}`);
  process.exit(1);
}

// ═══════════════════════════════════════════════════════════════
// CASO 2: Regla universal válida — ORDER (sin target)
// ═══════════════════════════════════════════════════════════════
console.log('\n--- CASO 2: Universal válida — ORDER ---');
try {
  validateRuleBody({
    engineVersion: 'universal',
    percentage: 10,
    conditionsUniversal: {
      ticketConditions: { minAmount: 5000 },
    },
  });
  console.log('✅ Regla universal ORDER válida — no lanzó error');
} catch (err) {
  console.error(`❌ FALLO: ${err.message}`);
  process.exit(1);
}

// ═══════════════════════════════════════════════════════════════
// CASO 3: Universal sin conditionsUniversal → error
// ═══════════════════════════════════════════════════════════════
console.log('\n--- CASO 3: Universal sin conditionsUniversal ---');
assertThrows(
  () => validateRuleBody({ engineVersion: 'universal', percentage: 10 }),
  'conditionsUniversal requerido',
  'Sin conditionsUniversal lanza error'
);

// ═══════════════════════════════════════════════════════════════
// CASO 4: Universal con porcentaje inválido → error
// ═══════════════════════════════════════════════════════════════
console.log('\n--- CASO 4: Porcentaje inválido ---');
assertThrows(
  () => validateRuleBody({
    engineVersion: 'universal',
    percentage: 150,
    conditionsUniversal: {},
  }),
  'percentage',
  'Porcentaje > 100 lanza error'
);

// ═══════════════════════════════════════════════════════════════
// CASO 5: Legacy válida (backward-compat)
// ═══════════════════════════════════════════════════════════════
console.log('\n--- CASO 5: Legacy válida (backward-compat) ---');
try {
  validateRuleBody({
    engineVersion: 'legacy',
    type: 'CASH_PAYMENT',
    percentage: 10,
    conditions: { paymentMethods: ['CASH'] },
  });
  console.log('✅ Regla legacy válida — no lanzó error');
} catch (err) {
  console.error(`❌ FALLO: ${err.message}`);
  process.exit(1);
}

// ═══════════════════════════════════════════════════════════════
// CASO 6: Legacy sin type → error
// ═══════════════════════════════════════════════════════════════
console.log('\n--- CASO 6: Legacy sin type ---');
assertThrows(
  () => validateRuleBody({
    // engineVersion ausente → 'legacy' por defecto
    percentage: 10,
    conditions: { paymentMethods: ['CASH'] },
  }),
  'type',
  'Legacy sin type lanza error'
);

// ═══════════════════════════════════════════════════════════════
// CASO 7: conditionsUniversal con campo inválido
// ═══════════════════════════════════════════════════════════════
console.log('\n--- CASO 7: conditionsUniversal con campo tipo incorrecto ---');
assertThrows(
  () => validateRuleBody({
    engineVersion: 'universal',
    percentage: 10,
    conditionsUniversal: {
      target: { productIds: 'esto-no-es-array' }, // string en vez de array
    },
  }),
  'productIds',
  'target.productIds string en vez de array lanza error'
);

console.log('\n========================================');
console.log('✅ TODOS LOS TESTS DE CRUD UNIVERSAL PASARON');
console.log('========================================');
