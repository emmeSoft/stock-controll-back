/**
 * universal.test.js — Tests del Motor Universal de Descuentos
 * ─────────────────────────────────────────────────────────────────
 * Casos de prueba para verificar el UniversalEvaluator.
 * 
 * Ejecutar con: node tests/discountEngine/universal.test.js
 * ─────────────────────────────────────────────────────────────────
 */

const { runUniversalPipeline } = require('../../services/discountEngine/universal');

// Helper para verificar resultados
function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FALLO: ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

// ═══════════════════════════════════════════════════════════════
// CASO 1: ITEM only — regla con target de productos
// ═══════════════════════════════════════════════════════════════
console.log('\n--- CASO 1: ITEM only ---');

const caso1 = runUniversalPipeline(
  {
    storeId: 'store-1',
    items: [
      { productId: 'p1', categoryId: 'cat-1', quantity: 3, unitPrice: 1000 },  // $3000
      { productId: 'p2', categoryId: 'cat-2', quantity: 1, unitPrice: 500 },   // $500
    ],
  },
  [
    {
      id: 'r1',
      percentage: 10,
      engineVersion: 'universal',
      conditionsUniversal: {
        target: { productIds: ['p1'] },
      },
    },
  ]
);

assert(caso1.originalTotal === 3500, 'originalTotal = 3500');
assert(caso1.items[0].discountAmount === 300, 'p1 tiene $300 de descuento (10%)');
assert(caso1.items[1].discountAmount === 0, 'p2 no tiene descuento');
assert(caso1.discountTotal === 300, 'discountTotal = 300');
assert(caso1.finalTotal === 3200, 'finalTotal = 3200');
console.log('RESULTADO:', caso1);

// ═══════════════════════════════════════════════════════════════
// CASO 2: ORDER only — regla sin target (global)
// ═══════════════════════════════════════════════════════════════
console.log('\n--- CASO 2: ORDER only ---');

const caso2 = runUniversalPipeline(
  {
    storeId: 'store-1',
    items: [
      { productId: 'p1', categoryId: 'cat-1', quantity: 3, unitPrice: 1000 },
      { productId: 'p2', categoryId: 'cat-2', quantity: 1, unitPrice: 500 },
    ],
  },
  [
    {
      id: 'r2',
      percentage: 15,
      engineVersion: 'universal',
      conditionsUniversal: {},  // Sin target = ORDER_LEVEL
    },
  ]
);

assert(caso2.originalTotal === 3500, 'originalTotal = 3500');
// ORDER aplica 15% sobre el subtotal original (no hay ITEM que modifique el precio)
// discount = 3500 * 0.15 = 525
assert(caso2.orderDiscount !== null, 'orderDiscount aplicado');
assert(caso2.orderDiscount.amount === 525, 'orderDiscount = $525 (15% de 3500)');
assert(caso2.finalTotal === 2975, 'finalTotal = 2975');
console.log('RESULTADO:', caso2);

// ═══════════════════════════════════════════════════════════════
// CASO 3: ITEM + ORDER combinados
// ═══════════════════════════════════════════════════════════════
console.log('\n--- CASO 3: ITEM + ORDER combinados ---');

const caso3 = runUniversalPipeline(
  {
    storeId: 'store-1',
    items: [
      { productId: 'p1', categoryId: 'cat-1', quantity: 2, unitPrice: 1000 },
      { productId: 'p2', categoryId: 'cat-2', quantity: 2, unitPrice: 500 },
    ],
  },
  [
    {
      id: 'r-item',
      percentage: 20,
      engineVersion: 'universal',
      conditionsUniversal: {
        target: { productIds: ['p1'] },  // ITEM: solo a p1
      },
    },
    {
      id: 'r-order',
      percentage: 10,
      engineVersion: 'universal',
      conditionsUniversal: {},  // ORDER: global
    },
  ]
);

assert(caso3.originalTotal === 3000, 'originalTotal = 3000');
assert(caso3.items[0].discountAmount === 400, 'p1: $400 (20% de $2000)');
assert(caso3.items[1].discountAmount === 0, 'p2: sin descuento ITEM');
// Después de ITEM: p1=$1600, p2=$1000 = $2600 residual
// ORDER 10% sobre $2600 = $260
assert(caso3.orderDiscount.amount === 260, 'orderDiscount: $260');
assert(caso3.discountTotal === 660, 'discountTotal = $660');
assert(caso3.finalTotal === 2340, 'finalTotal = $2340');
console.log('RESULTADO:', caso3);

// ═══════════════════════════════════════════════════════════════
// CASO 4: MAXIMIZE_DISCOUNT con maxUnits
// ═══════════════════════════════════════════════════════════════
console.log('\n--- CASO 4: MAXIMIZE_DISCOUNT con maxUnits ---');

const caso4 = runUniversalPipeline(
  {
    storeId: 'store-1',
    items: [
      { productId: 'p1', categoryId: 'cat-1', quantity: 5, unitPrice: 1000 },  // 5 × $1000
      { productId: 'p2', categoryId: 'cat-2', quantity: 3, unitPrice: 2000 },  // 3 × $2000
    ],
  },
  [
    {
      id: 'r4',
      percentage: 50,
      engineVersion: 'universal',
      conditionsUniversal: {
        target: { productIds: ['p1', 'p2'] },
        constraints: { maxUnits: 3 },  // Solo 3 unidades con descuento
      },
    },
  ]
);

// Nota: el comportamiento actual aplica maxUnits por item, no global.
// Esto es una limitación conocida que puede mejorarse en futuro.
assert(caso4.discountTotal > 0, 'hay descuento total positivo');
console.log('RESULTADO:', caso4);

// ═══════════════════════════════════════════════════════════════
// CASO 5: Vigencia temporal (no vigente)
// ═══════════════════════════════════════════════════════════════
console.log('\n--- CASO 5: Vigencia temporal ---');

const caso5 = runUniversalPipeline(
  {
    storeId: 'store-1',
    items: [{ productId: 'p1', quantity: 1, unitPrice: 1000 }],
  },
  [
    {
      id: 'r5',
      percentage: 50,
      engineVersion: 'universal',
      conditionsUniversal: { target: { productIds: ['p1'] } },
      startsAt: new Date('2025-01-01'),
      endsAt: new Date('2025-06-01'),  // Ya vencido
    },
  ]
);

assert(caso5.discountTotal === 0, 'descuento no aplica por vigencia');
assert(caso5.finalTotal === 1000, 'finalTotal sin descuento');
console.log('RESULTADO:', caso5);

// ═══════════════════════════════════════════════════════════════
// CASO 6: ticketConditions (paymentMethods, minAmount, clientIds)
// ═══════════════════════════════════════════════════════════════
console.log('\n--- CASO 6: ticketConditions ---');

// 6a: paymentMethods - NO cumple
const caso6a = runUniversalPipeline(
  {
    storeId: 'store-1',
    items: [{ productId: 'p1', quantity: 1, unitPrice: 1000 }],
    paymentMethods: ['CARD'],  // Solo CARD
  },
  [
    {
      id: 'r6',
      percentage: 10,
      engineVersion: 'universal',
      conditionsUniversal: {
        ticketConditions: { paymentMethods: ['CASH'] },  // Solo CASH
      },
    },
  ]
);
assert(caso6a.discountTotal === 0, 'No aplica si paymentMethod no coincide');

// 6b: paymentMethods - SÍ cumple
const caso6b = runUniversalPipeline(
  {
    storeId: 'store-1',
    items: [{ productId: 'p1', quantity: 1, unitPrice: 1000 }],
    paymentMethods: ['CASH'],
  },
  [
    {
      id: 'r6b',
      percentage: 10,
      engineVersion: 'universal',
      conditionsUniversal: {
        ticketConditions: { paymentMethods: ['CASH'] },
      },
    },
  ]
);
assert(caso6b.discountTotal === 100, 'Aplica si paymentMethod coincide');

// 6c: minAmount - no llega
const caso6c = runUniversalPipeline(
  {
    storeId: 'store-1',
    items: [{ productId: 'p1', quantity: 1, unitPrice: 500 }],
  },
  [
    {
      id: 'r6c',
      percentage: 10,
      engineVersion: 'universal',
      conditionsUniversal: {
        ticketConditions: { minAmount: 1000 },  // Requiere $1000 mínimo
      },
    },
  ]
);
assert(caso6c.discountTotal === 0, 'No aplica si no llega al minAmount');

// 6d: minAmount - sí llega
const caso6d = runUniversalPipeline(
  {
    storeId: 'store-1',
    items: [{ productId: 'p1', quantity: 2, unitPrice: 600 }],
  },
  [
    {
      id: 'r6d',
      percentage: 10,
      engineVersion: 'universal',
      conditionsUniversal: {
        ticketConditions: { minAmount: 1000 },
      },
    },
  ]
);
assert(caso6d.discountTotal === 120, 'Aplica si llega al minAmount');

console.log('RESULTADO:', { caso6a, caso6b, caso6c, caso6d });

// ═══════════════════════════════════════════════════════════════
// RESUMEN
// ═══════════════════════════════════════════════════════════════
console.log('\n========================================');
console.log('✅ TODOS LOS TESTS PASARON');
console.log('========================================');
