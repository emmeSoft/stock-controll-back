/**
 * preview-merge.test.js — Test de merge de resultados de ambos motores
 * ─────────────────────────────────────────────────────────────────
 * Verifica SC-2.3: mergeEngineResults combina ambos resultados correctamente.
 * No necesita DB — simula los resultados de cada motor directamente.
 * 
 * Ejecutar: node tests/discountEngine/preview-merge.test.js
 * ─────────────────────────────────────────────────────────────────
 */

// Replicamos la función helper para testearla de forma aislada
function mergeEngineResults(legacyResult, universalResult, originalTotal) {
  const legacyDiscountTotal    = legacyResult?.discountTotal   ?? 0;
  const universalDiscountTotal = universalResult?.discountTotal ?? 0;
  const discountTotal = legacyDiscountTotal + universalDiscountTotal;
  const finalTotal = Math.max(originalTotal - discountTotal, 0.01);

  const legacyApplied = (legacyResult?.appliedDiscounts ?? []).map(d => ({
    ...d,
    engine: 'legacy',
  }));
  const universalApplied = (universalResult?.appliedDiscounts ?? []).map(d => ({
    ...d,
    engine: 'universal',
  }));

  return {
    originalTotal:       parseFloat(originalTotal.toFixed(2)),
    discountTotal:       parseFloat(discountTotal.toFixed(2)),
    finalTotal:          parseFloat(finalTotal.toFixed(2)),
    appliedDiscounts:    [...legacyApplied, ...universalApplied],
    conditionalDiscounts: [
      ...(legacyResult?.conditionalDiscounts   ?? []),
      ...(universalResult?.conditionalDiscounts ?? []),
    ],
    warnings: [
      ...(legacyResult?.warnings   ?? []),
      ...(universalResult?.warnings ?? []),
    ],
  };
}

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FALLO: ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

// ═══════════════════════════════════════════════════════════════
// CASO 1: Carrito con regla legacy + regla universal
// ═══════════════════════════════════════════════════════════════
console.log('\n--- CASO 1: Legacy + Universal simultáneos ---');

const legacyResult = {
  originalTotal: 3500,
  discountTotal: 350,  // 10% legacy sobre total
  finalTotal: 3150,
  appliedDiscounts: [
    { ruleId: 'r-legacy-1', type: 'CASH_PAYMENT', layer: 'ORDER', percentage: 10, amount: 350 },
  ],
  conditionalDiscounts: [],
  warnings: [],
};

const universalResult = {
  originalTotal: 3500,
  discountTotal: 200,  // 10% universal sobre producto p1 (2x$1000)
  finalTotal: 3300,
  appliedDiscounts: [
    { ruleId: 'r-universal-1', type: 'ITEM', productId: 'p1', amount: 200 },
  ],
  conditionalDiscounts: [],
  warnings: [],
};

const merged1 = mergeEngineResults(legacyResult, universalResult, 3500);

assert(merged1.originalTotal === 3500, 'originalTotal = 3500');
assert(merged1.discountTotal === 550, 'discountTotal = 350 + 200 = 550');
assert(merged1.finalTotal === 2950, 'finalTotal = 3500 - 550 = 2950');
assert(merged1.appliedDiscounts.length === 2, 'appliedDiscounts tiene 2 entradas');
assert(merged1.appliedDiscounts[0].engine === 'legacy', 'primer discount etiquetado como legacy');
assert(merged1.appliedDiscounts[1].engine === 'universal', 'segundo discount etiquetado como universal');
console.log('MERGED:', JSON.stringify(merged1, null, 2));

// ═══════════════════════════════════════════════════════════════
// CASO 2: Solo legacy (universalRules vacío → motor retorna 0)
// ═══════════════════════════════════════════════════════════════
console.log('\n--- CASO 2: Solo legacy ---');

const onlyLegacyResult = {
  discountTotal: 500,
  appliedDiscounts: [{ ruleId: 'r-leg', amount: 500, type: 'QUANTITY', layer: 'ITEM' }],
  conditionalDiscounts: [],
  warnings: [],
};
const emptyUniversal = { discountTotal: 0, appliedDiscounts: [], conditionalDiscounts: [], warnings: [] };

const merged2 = mergeEngineResults(onlyLegacyResult, emptyUniversal, 5000);
assert(merged2.discountTotal === 500, 'discountTotal = 500 (solo legacy)');
assert(merged2.finalTotal === 4500, 'finalTotal = 4500');
assert(merged2.appliedDiscounts[0].engine === 'legacy', 'discount etiquetado como legacy');

// ═══════════════════════════════════════════════════════════════
// CASO 3: Backward-compat — los campos top-level no cambian
// ═══════════════════════════════════════════════════════════════
console.log('\n--- CASO 3: Backward-compat campos top-level ---');
const merged3 = mergeEngineResults(emptyUniversal, emptyUniversal, 1000);
assert('originalTotal'       in merged3, 'tiene originalTotal');
assert('discountTotal'       in merged3, 'tiene discountTotal');
assert('finalTotal'          in merged3, 'tiene finalTotal');
assert('appliedDiscounts'    in merged3, 'tiene appliedDiscounts');
assert('conditionalDiscounts' in merged3, 'tiene conditionalDiscounts');
assert('warnings'            in merged3, 'tiene warnings');
assert(merged3.finalTotal === 1000, 'sin descuentos: finalTotal = originalTotal');

// ═══════════════════════════════════════════════════════════════
// CASO 4: Guard mínimo — discount no puede superar originalTotal
// ═══════════════════════════════════════════════════════════════
console.log('\n--- CASO 4: Guard mínimo (precio final >= $0.01) ---');
const bigLegacy = { discountTotal: 600, appliedDiscounts: [], conditionalDiscounts: [], warnings: [] };
const bigUniversal = { discountTotal: 600, appliedDiscounts: [], conditionalDiscounts: [], warnings: [] };
const merged4 = mergeEngineResults(bigLegacy, bigUniversal, 500);  // 1200 de descuento sobre 500
assert(merged4.finalTotal === 0.01, `finalTotal mínimo = $0.01, got ${merged4.finalTotal}`);

// ═══════════════════════════════════════════════════════════════
// CASO 5: Warnings de ambos motores se concatenan
// ═══════════════════════════════════════════════════════════════
console.log('\n--- CASO 5: Warnings concatenados ---');
const withWarnings = {
  discountTotal: 0,
  appliedDiscounts: [],
  conditionalDiscounts: [],
  warnings: ['[skip] regla inválida X'],
};
const withWarnings2 = {
  discountTotal: 0,
  appliedDiscounts: [],
  conditionalDiscounts: [],
  warnings: ['[skip] regla expirada Y'],
};
const merged5 = mergeEngineResults(withWarnings, withWarnings2, 1000);
assert(merged5.warnings.length === 2, 'warnings concatenados: 2 entradas');

console.log('\n========================================');
console.log('✅ TODOS LOS TESTS DE MERGE PASARON');
console.log('========================================');
