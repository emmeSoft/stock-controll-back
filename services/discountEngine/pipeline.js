/**
 * pipeline.js — Motor de Descuentos v3
 * ─────────────────────────────────────────────────────────────────
 * Pipeline principal. Recibe un EvaluationContext y devuelve un
 * DiscountResult con los descuentos aplicados, el total descontado
 * y los descuentos condicionales (si los hay).
 *
 * PASOS:
 *  1. Fetch de reglas activas por tienda
 *  2. Filtrado por vigencia temporal (startsAt / endsAt)
 *  3. Validación de conditions por tipo (skip con warning si inválido)
 *  4. Derivación de layer desde DiscountType (AXIOMA 1)
 *  5. Evaluación por tipo usando evaluadores específicos
 *  6. Separación por layer (ITEM vs ORDER)
 *  7. Resolución de conflictos ITEM (competitivo → gana el de mayor %)
 *  8. Resolución de combinabilidad ORDER (cooperativo con restricciones)
 *  9. Aplicación de tope global store.maxDiscountPct (AXIOMA 3)
 * 10. Cálculo final de montos
 * ─────────────────────────────────────────────────────────────────
 */

const { getLayer }              = require('./layerMap');
const { validateConditions }    = require('./validators');
const { ORDER_COMBINABLE_TYPES, GUARD_MIN_PRICE, DEFAULT_STORE_CAP_PCT } = require('./constants');

// Evaluadores por tipo
const EVALUATORS = {
  QUANTITY:      require('./evaluators/quantityEvaluator'),
  CASH_PAYMENT:  require('./evaluators/cashPaymentEvaluator'),
  CLIENT:        require('./evaluators/clientEvaluator'),
  SPECIAL_DATE:  require('./evaluators/specialDateEvaluator'),
  PRODUCT:       require('./evaluators/productEvaluator'),
  CATEGORY:      require('./evaluators/categoryEvaluator'),
  MIN_AMOUNT:    require('./evaluators/minAmountEvaluator'),
  LIMITED_STOCK: require('./evaluators/limitedStockEvaluator'),
};

// ─────────────────────────────────────────────────────────────────
// Tipos internos (JSDoc)
// ─────────────────────────────────────────────────────────────────
/**
 * @typedef {Object} CartItem
 * @property {string} productId
 * @property {string} [categoryId]
 * @property {number} quantity
 * @property {number} unitPrice   — precio unitario sin descuentos
 */

/**
 * @typedef {Object} EvaluationContext
 * @property {string}     storeId
 * @property {CartItem[]} items
 * @property {string}     [clientId]
 * @property {string[]}   [paymentMethods]  — métodos seleccionados (puede ser vacío en preview)
 * @property {number}     [orderSubtotal]   — si ya se computó fuera; si no, el pipeline lo calcula
 * @property {Date}       [now]             — inyectable para tests; default = new Date()
 * @property {object}     [store]           — { maxDiscountPct }
 * @property {object[]}   [rules]           — inyectable para tests; si no, el pipeline hace fetch
 * @property {object}     [prisma]          — cliente Prisma (requerido si rules no se inyectan)
 */

/**
 * @typedef {Object} AppliedDiscountResult
 * @property {string}  ruleId
 * @property {string}  type
 * @property {string}  layer
 * @property {number}  percentage        — efectivo (post-tope)
 * @property {number}  amount            — monto $ descontado
 * @property {string}  [productId]       — solo ITEM
 * @property {number}  [discountedQty]   — solo LIMITED_STOCK
 * @property {string}  reason
 */

/**
 * @typedef {Object} DiscountResult
 * @property {number}                 originalTotal
 * @property {number}                 discountTotal
 * @property {number}                 finalTotal
 * @property {AppliedDiscountResult[]} appliedDiscounts
 * @property {object[]}               conditionalDiscounts  — CASH_PAYMENT pendiente de método
 * @property {string[]}               warnings              — reglas skipped con motivo
 */

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

/** Calcula el subtotal del carrito (precio unitario × cantidad) */
function computeSubtotal(items) {
  return items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);
}

/** Filtra reglas activas por vigencia temporal */
function filterByValidity(rules, now) {
  return rules.filter(rule => {
    if (rule.startsAt && new Date(rule.startsAt) > now) return false;
    if (rule.endsAt   && new Date(rule.endsAt)   < now) return false;
    return true;
  });
}

/**
 * PASO 7 — Resolución de conflictos ITEM (competitivo).
 * Por cada productId sólo sobrevive la regla con mayor porcentaje.
 * Si dos reglas tienen el mismo %, gana la de mayor priority.
 */
function resolveItemConflicts(itemMatches) {
  const winners = new Map(); // productId → mejor match

  for (const match of itemMatches) {
    for (const productId of match.result.applicableItems) {
      const current = winners.get(productId);
      if (!current) {
        winners.set(productId, { ...match, forProduct: productId });
        continue;
      }
      const isBetter =
        match.rule.percentage > current.rule.percentage ||
        (match.rule.percentage === current.rule.percentage &&
          match.rule.priority > current.rule.priority);
      if (isBetter) {
        winners.set(productId, { ...match, forProduct: productId });
      }
    }
  }

  return Array.from(winners.values());
}

/**
 * PASO 8 — Resolución de combinabilidad ORDER (cooperativo).
 * Reglas no combinables se tratan como competitivas entre sí: gana la de mayor %.
 * Las combinables se acumulan respetando la matriz ORDER_COMBINABLE_TYPES.
 */
function resolveOrderCombinability(orderMatches) {
  // Separar combinables de no-combinables
  const combinable    = orderMatches.filter(m => m.rule.isCombinable);
  const nonCombinable = orderMatches.filter(m => !m.rule.isCombinable);

  // De las no-combinables, solo el mayor porcentaje pasa
  let winner = null;
  for (const m of nonCombinable) {
    if (!winner || m.rule.percentage > winner.rule.percentage) winner = m;
  }

  const selected = winner ? [winner] : [];

  // De las combinables: validar la matriz de tipos permitidos
  // Un tipo combinable SOLO puede sumar si es compatible con TODOS los ya seleccionados
  for (const m of combinable) {
    const typeA = m.rule.type;
    const alreadySelectedTypes = selected.map(s => s.rule.type);

    const compatible = alreadySelectedTypes.every(typeB => {
      const allowedForA = ORDER_COMBINABLE_TYPES[typeA] ?? [];
      const allowedForB = ORDER_COMBINABLE_TYPES[typeB] ?? [];
      return allowedForA.includes(typeB) && allowedForB.includes(typeA);
    });

    if (compatible) selected.push(m);
  }

  return selected;
}

/**
 * PASO 9 — Tope global de descuento por tienda.
 * Escala todos los porcentajes proporcionalmente si la suma supera el cap.
 */
function applyStoreCap(appliedPct, capPct) {
  if (appliedPct <= capPct) return 1; // factor = 1, sin recorte
  return capPct / appliedPct;         // factor < 1, escala proporcional
}

// ─────────────────────────────────────────────────────────────────
// Pipeline principal
// ─────────────────────────────────────────────────────────────────

/**
 * @param {EvaluationContext} context
 * @returns {Promise<DiscountResult>}
 */
async function runPipeline(context) {
  const now      = context.now ? new Date(context.now) : new Date();
  const warnings = [];
  const conditionalDiscounts = [];

  // ── PASO 1: Fetch de reglas ────────────────────────────────────
  let rules = context.rules; // inyectadas (tests)
  if (!rules) {
    if (!context.prisma) throw new Error('[pipeline] Se requiere prisma o rules en el contexto');
    rules = await context.prisma.discountRule.findMany({
      where: { storeId: context.storeId, isActive: true },
    });
  }

  // ── PASO 2: Filtrado por vigencia temporal ─────────────────────
  const validRules = filterByValidity(rules, now);

  // ── PASO 3: Validar conditions + PASO 4: Derivar layer ─────────
  const checkedRules = [];
  for (const rule of validRules) {
    const condError = validateConditions(rule.type, rule.conditions);
    if (condError) {
      warnings.push(`[skip] Regla "${rule.name}" (${rule.id}): ${condError}`);
      continue;
    }
    try {
      rule._layer = getLayer(rule.type); // AXIOMA 1: layer derivado, nunca del request
      checkedRules.push(rule);
    } catch (err) {
      warnings.push(`[skip] Regla "${rule.name}": ${err.message}`);
    }
  }

  // Ordenar por prioridad desc antes de evaluar
  checkedRules.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

  // ── PASO 5: Evaluación por tipo ────────────────────────────────
  // Calcular subtotal del carrito para MIN_AMOUNT
  const rawSubtotal = context.orderSubtotal ?? computeSubtotal(context.items);
  const evalContext = { ...context, orderSubtotal: rawSubtotal, now };

  const itemMatches  = [];
  const orderMatches = [];

  for (const rule of checkedRules) {
    const evaluator = EVALUATORS[rule.type];
    if (!evaluator) {
      warnings.push(`[skip] No hay evaluador para el tipo "${rule.type}"`);
      continue;
    }

    let result;
    try {
      result = evaluator.evaluate(rule, evalContext);
    } catch (err) {
      warnings.push(`[skip] Error evaluando regla "${rule.name}": ${err.message}`);
      continue;
    }

    // Descuentos condicionales (CASH_PAYMENT sin método seleccionado)
    if (result.isConditional) {
      conditionalDiscounts.push({ rule, result });
      continue;
    }

    if (!result.matches) continue;

    // ── PASO 6: Separar por layer ──────────────────────────────
    if (rule._layer === 'ITEM') {
      itemMatches.push({ rule, result });
    } else {
      orderMatches.push({ rule, result });
    }
  }

  // ── PASO 7: Conflictos ITEM (competitivo) ──────────────────────
  const winningItemMatches = resolveItemConflicts(itemMatches);

  // ── PASO 8: Combinabilidad ORDER (cooperativo) ─────────────────
  const winningOrderMatches = resolveOrderCombinability(orderMatches);

  // ── PASO 9 + 10: Tope global y cálculo de montos ──────────────
  const storeCap = context.store?.maxDiscountPct ?? DEFAULT_STORE_CAP_PCT;

  const appliedDiscounts = [];

  // ── ITEM: descuento por producto ──────────────────────────────
  // Calcular porcentaje total ITEM para tope (se aplica por producto individualmente)
  for (const match of winningItemMatches) {
    const { rule, forProduct } = match;
    const item = context.items.find(i => i.productId === forProduct);
    if (!item) continue;

    const itemTotal   = item.unitPrice * item.quantity;
    const rawPct      = rule.percentage;
    // Para ITEM el tope se aplica individualmente (cada producto tiene su propio tope)
    const cappedPct   = Math.min(rawPct, storeCap);
    const amount      = Math.max(itemTotal * cappedPct / 100, 0);

    if (amount <= 0) continue; // AXIOMA 13

    appliedDiscounts.push({
      ruleId:     rule.id,
      type:       rule.type,
      layer:      'ITEM',
      percentage: cappedPct,
      amount:     parseFloat(amount.toFixed(2)),
      productId:  forProduct,
      discountedQty: rule.type === 'LIMITED_STOCK'
        ? (match.result.applicableQuantities?.find(q => q.productId === forProduct)?.applicableQuantity ?? item.quantity)
        : undefined,
      reason: match.result.reason,
    });
  }

  // ── ORDER: acumulativo con tope global ────────────────────────
  const totalItemDiscount  = appliedDiscounts.reduce((s, d) => s + (d.layer === 'ITEM' ? d.amount : 0), 0);
  const subtotalAfterItem  = Math.max(rawSubtotal - totalItemDiscount, GUARD_MIN_PRICE);

  // Suma de porcentajes ORDER para verificar tope
  const totalOrderPct = winningOrderMatches.reduce((s, m) => s + m.rule.percentage, 0);
  const capFactor     = applyStoreCap(totalOrderPct, storeCap);

  for (const match of winningOrderMatches) {
    const { rule } = match;
    const effectivePct = rule.percentage * capFactor;
    const amount       = Math.max(subtotalAfterItem * effectivePct / 100, 0);

    if (amount <= 0) continue; // AXIOMA 13

    appliedDiscounts.push({
      ruleId:     rule.id,
      type:       rule.type,
      layer:      'ORDER',
      percentage: parseFloat(effectivePct.toFixed(4)),
      amount:     parseFloat(amount.toFixed(2)),
      reason:     match.result.reason,
    });
  }

  // ── Resultado final ────────────────────────────────────────────
  const discountTotal = appliedDiscounts.reduce((s, d) => s + d.amount, 0);
  const finalTotal    = Math.max(rawSubtotal - discountTotal, GUARD_MIN_PRICE);

  return {
    originalTotal:       parseFloat(rawSubtotal.toFixed(2)),
    discountTotal:       parseFloat(discountTotal.toFixed(2)),
    finalTotal:          parseFloat(finalTotal.toFixed(2)),
    appliedDiscounts,
    conditionalDiscounts: conditionalDiscounts.map(({ rule, result }) => ({
      ruleId:     rule.id,
      type:       rule.type,
      percentage: rule.percentage,
      reason:     result.reason,
    })),
    warnings,
  };
}

module.exports = { runPipeline };
