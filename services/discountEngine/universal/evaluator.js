/**
 * evaluator.js — Universal Discount Engine
 * ─────────────────────────────────────────────────────────────────
 * Lógica de filtrado por vigencia y evaluación por capas.
 * 
 * Responsibilities:
 *  - filterByVigency: filtra reglas por fecha startsAt/endsAt
 *  - splitByLayer: separa reglas en ITEM_LEVEL vs ORDER_LEVEL
 *  - evaluateUniversal: evaluación completa del pipeline
 * 
 * @typedef {Object} UniversalConditions
 * @property {Object} [target] - Targeting de productos/categorías
 * @property {string[]} [target.productIds] - IDs de productos específicos
 * @property {string[]} [target.categoryIds] - IDs de categorías
 * @property {Object} [ticketConditions] - Condiciones de la orden
 * @property {string[]} [ticketConditions.paymentMethods] - Métodos de pago válidos
 * @property {number} [ticketConditions.minAmount] - Monto mínimo requerido
 * @property {boolean} [ticketConditions.allClients] - Aplica a todos los clientes
 * @property {string[]} [ticketConditions.clientIds] - Clientes específicos
 * @property {Object} [itemConditions] - Condiciones por ítem
 * @property {number} [itemConditions.minQuantity] - Cantidad mínima de unidades
 * @property {Object} [constraints] - Restricciones
 * @property {number} [constraints.maxUnits] - Unidades máximas con descuento
 * 
 * @example
 * // Ejemplo de conditionsUniversal completo
 * {
 *   target: { productIds: ['p1', 'p2'], categoryIds: ['cat-1'] },
 *   ticketConditions: { paymentMethods: ['CASH'], minAmount: 1000, clientIds: ['c1'] },
 *   itemConditions: { minQuantity: 3 },
 *   constraints: { maxUnits: 10 }
 * }
 * ─────────────────────────────────────────────────────────────────
 */

const {
  simulateMonetaryImpact,
  applyDiscount,
  calculateResidualSubtotal,
  findBestItemRule,
  resolveOrderDiscounts,
  GUARD_MIN_PRICE,
} = require('./calculator');
const { money, toNumber, sum, D, isPositiveAmount } = require('../../../utils/money');

/**
 * Valida que cada entrada de `paymentBreakdown` tenga un `amount` numérico,
 * finito y positivo ANTES de usarlo en aritmética Decimal (`money()`/`sum()`).
 *
 * Sin este check, un payload malformado (`amount: 'abc'` o ausente) llega
 * directo a `money()` y revienta con un error no controlado.
 *
 * IMPORTANTE: este check SOLO corre, en este archivo, cuando hay una regla
 * ORDER_LEVEL activa con `ticketConditions.paymentMethods` seteado (rama
 * proporcional de `validateTicketConditions` más abajo) — es decir, el caso
 * RARO. Para el caso común (una venta sin ninguna regla de ese tipo activa,
 * que es la mayoría), este call site nunca corre.
 *
 * Por eso `salesServices.create()` (el flujo real de venta) importa y llama
 * esta misma función de forma INCONDICIONAL, apenas llega `paymentBreakdown`
 * al body — antes de `validatePayments()` y de los cálculos de `ccAmount`/
 * `nonCCTotal`, que hacen la misma aritmética Decimal sin ningún guard propio.
 * Se exporta desde este módulo (en vez de duplicarla) para que ambos call
 * sites compartan exactamente la misma semántica de validación.
 *
 * @param {Object[]} paymentBreakdown - [{ method, amount }]
 * @throws {Error} 400 INVALID_PAYMENT_AMOUNT si algún `amount` no es un
 *                 número finito y positivo.
 */
function validatePaymentBreakdownAmounts(paymentBreakdown) {
  for (const p of paymentBreakdown) {
    if (!isPositiveAmount(p?.amount)) {
      throw Object.assign(
        new Error(
          `El monto de pago para el método '${p?.method ?? 'desconocido'}' debe ser un número positivo y finito.`
        ),
        { status: 400, code: 'INVALID_PAYMENT_AMOUNT' }
      );
    }
  }
}

/**
 * Filtra reglas por vigencia temporal.
 * @param {Object[]} rules - Reglas a filtrar
 * @param {Date} now - Fecha actual (para tests inyectar)
 * @returns {Object[]} Reglas vigentes
 */
function filterByVigency(rules, now = new Date()) {
  return rules.filter(rule => {
    const startsAt = rule.startsAt ? new Date(rule.startsAt) : null;
    const endsAt = rule.endsAt ? new Date(rule.endsAt) : null;

    if (startsAt && now < startsAt) return false;
    if (endsAt && now > endsAt) return false;

    return true;
  });
}

/**
 * Separa reglas en ITEM_LEVEL vs ORDER_LEVEL basado en el target.
 * @param {Object[]} rules - Reglas filtradas por vigencia
 * @returns {Object} { itemRules, orderRules }
 */
function splitByLayer(rules) {
  const itemRules = [];
  const orderRules = [];

  for (const rule of rules) {
    const conditions = rule.conditionsUniversal ?? {};
    const target = conditions.target;

    // Verificar si el target tiene contenido real (productIds o categoryIds)
    const hasTargetContent = target && (target.productIds?.length > 0 || target.categoryIds?.length > 0);

    // Si tiene target con contenido real → ITEM_LEVEL
    // Si target es null, undefined, o vacío → ORDER_LEVEL
    if (hasTargetContent) {
      itemRules.push(rule);
    } else {
      orderRules.push(rule);
    }
  }

  return { itemRules, orderRules };
}

/**
 * Valida las ticketConditions (condiciones globales de la orden).
 * @param {Object} ticketConditions - { paymentMethods, minAmount, allClients, clientIds }
 * @param {Object} context - { clientId, paymentMethods, orderSubtotal }
 * @returns {boolean} true si cumple las condiciones
 */
function validateTicketConditions(ticketConditions, context, rule = {}) {
  if (!ticketConditions) return true;

  const { paymentMethods, minAmount, allClients, clientIds } = ticketConditions;
  const allowPartial = rule.allowPartial ?? false;

  // ── 1. Validación de Métodos de Pago (El Cambio Clave) ──────────
  if (paymentMethods?.length > 0) {
    // Si no hay desglose, caemos en la lógica binaria anterior (seguridad)
    if (!context.paymentBreakdown || context.paymentBreakdown.length === 0) {
      const hasPaymentMatch = paymentMethods.some(pm =>
        context.paymentMethods?.includes(pm)
      );
      if (!hasPaymentMatch) return false;

      // En modo binario, asumimos impacto total si coincide
      rule._matchingAmount = context.orderSubtotal;
    } else {
      // Cálculo preciso: qué proporción de `context.orderSubtotal` (el
      // subtotal vigente en este call site — ver nota más abajo sobre por
      // qué NO es necesariamente el bruto pre-descuento) corresponde a los
      // medios de pago válidos para esta regla.
      //
      // SEGURIDAD: antes se confiaba en `p.baseAmount`, un campo que el
      // FRONTEND (DiscountSummaryModal.jsx) calculaba para decirle al
      // backend qué proporción BRUTA representaba cada pago. Eso viola la
      // regla de este proyecto de que ningún monto usado para calcular
      // descuentos puede venir calculado por el cliente (ver cabecera de
      // salesServices.js: "Nunca se confía en precios ni totales
      // provenientes del frontend").
      //
      // Fix: el backend deriva la proporción él mismo con datos que ya
      // conoce y valida, sin depender de ningún campo extra del cliente:
      //   - context.orderSubtotal: en este call site (ticketConditions de
      //     reglas ORDER, invocado desde evaluateUniversal vía
      //     filterOrderRulesByTicketConditions) este valor NO es el
      //     subtotal bruto original — es `residualSubtotal`, el subtotal
      //     que queda DESPUÉS de aplicar los descuentos ITEM
      //     (evaluateUniversal hace `{ ...context, orderSubtotal:
      //     residualSubtotal }` antes de llegar acá). Sigue siendo un
      //     valor calculado por el backend desde precios de DB, nunca del
      //     cliente — pero no asumir que es el total bruto pre-descuento.
      //   - p.amount: el monto que el vendedor efectivamente ingresó para
      //     ese medio de pago — dato operativo real (cuánta plata entra
      //     por esa vía), no un precio "calculado"; ya se valida contra
      //     el total en salesServices.validatePayments.
      //
      // proporción_método = amount_método / totalPagado
      // montoCorrespondiente_método = proporción_método × orderSubtotal
      //
      // Como efecto colateral, esta fórmula no usa en ningún momento el
      // nombre/identidad de la regla — a diferencia del baseAmount
      // calculado en el front, que (según el bug reportado) podía
      // desincronizarse si se renombraba una regla. Al no depender de eso,
      // renombrar una regla ya no puede alterar este cálculo.
      // Validar la forma de cada entrada ANTES de cualquier aritmética Decimal
      // (ver docstring de validatePaymentBreakdownAmounts arriba).
      validatePaymentBreakdownAmounts(context.paymentBreakdown);

      const totalPaid = toNumber(sum(context.paymentBreakdown, (p) => p.amount));

      if (totalPaid <= 0) return false;

      const matchingAmount = toNumber(sum(
        context.paymentBreakdown.filter(p => paymentMethods.includes(p.method)),
        (p) => money(p.amount).dividedBy(totalPaid).times(context.orderSubtotal)
      ));

      if (matchingAmount <= 0) return false;

      // Si allowPartial es false, el pago debe cubrir TODO el subtotal
      if (!allowPartial && money(matchingAmount).lt(money(context.orderSubtotal).minus(0.01))) {
        return false;
      }

      // Guardamos el monto para que el calculador sepa sobre qué aplicar el %
      rule._matchingAmount = Math.min(matchingAmount, context.orderSubtotal);
    }
  } else {
    // Si la regla no tiene restricción de pago, aplica sobre el total
    rule._matchingAmount = context.orderSubtotal;
  }

  // ── 2. minAmount: el subtotal debe ser >= minAmount ──────────────
  if (minAmount > 0 && context.orderSubtotal < minAmount) {
    return false;
  }

  // ── 3. allClients / clientIds ────────────────────────────────────
  if (allClients === true) return true;

  if (clientIds?.length > 0) {
    if (!context.clientId || !clientIds.includes(context.clientId)) {
      return false;
    }
  }

  return true;
}

/**
 * Evalúa las ticketConditions para cada regla ORDER.
 * @param {Object[]} orderRules - Reglas ORDER_LEVEL
 * @param {Object} context - Contexto de evaluación
 * @returns {Object[]} Reglas ORDER que pasan las condiciones
 */
function filterOrderRulesByTicketConditions(orderRules, context) {
  return orderRules.filter(rule => {
    const conditions = rule.conditionsUniversal ?? {};
    return validateTicketConditions(conditions.ticketConditions, context, rule);
  });
}

/**
 * Evalúa el contexto completo usando el motor universal.
 * @param {Object} context - { storeId, items, clientId, paymentMethods, orderSubtotal?, now? }
 * @param {Object[]} rules - Reglas de descuento
 * @returns {Object} Resultado con descuentos aplicados
 */
function evaluateUniversal(context, rules) {
  const now = context.now ?? new Date();
  const items = context.items ?? [];

  // Preparar items con originalSubtotal calculado.
  // item.unitPrice puede ser un Prisma.Decimal real (viene de product.price) o
  // un number plano (tests) — money() soporta ambos.
  const itemsWithSubtotal = items.map(item => ({
    ...item,
    originalSubtotal: item.originalSubtotal ?? toNumber(money(item.unitPrice).times(item.quantity)),
  }));

  // Paso 1: Filtrar por vigencia
  const vigenteRules = filterByVigency(rules, now);

  // Paso 2: Separar por capa
  const { itemRules, orderRules } = splitByLayer(vigenteRules);

  // Calcular subtotal original
  const originalTotal = toNumber(sum(itemsWithSubtotal, (item) => item.originalSubtotal));

  // Paso 3: Evaluar ITEM_LEVEL por cada item
  const itemsWithDiscounts = itemsWithSubtotal.map(item => {
    // Filtrar reglas que aplican a este item
    const applicableItemRules = itemRules.filter(rule => {
      const impact = simulateMonetaryImpact(rule, item);
      return impact > 0;
    });

    // Encontrar la mejor regla (mayor impacto monetario)
    const bestRule = findBestItemRule(applicableItemRules, item);

    if (!bestRule) {
      const originalSubtotal = item.originalSubtotal ?? toNumber(money(item.unitPrice).times(item.quantity));
      return {
        ...item,
        originalSubtotal,
        discountableQuantity: 0,
        discountAmount: 0,
        finalPrice: originalSubtotal,  // Sin descuento = original
        appliedRule: null,
      };
    }

    // Aplicar descuento
    const conditions = bestRule.conditionsUniversal ?? {};
    const maxUnits = conditions.constraints?.maxUnits;
    return applyDiscount(item, bestRule, maxUnits);
  });

  // Paso 4: Calcular residual subtotal
  const residualSubtotal = calculateResidualSubtotal(itemsWithDiscounts);

  // Paso 5: Evaluar ORDER_LEVEL sobre el residual
  const contextWithResidual = {
    ...context,
    orderSubtotal: residualSubtotal,
  };

  const validOrderRules = filterOrderRulesByTicketConditions(orderRules, contextWithResidual);
  const orderDiscountResult = resolveOrderDiscounts(validOrderRules, residualSubtotal);

  let orderDiscountAmount = 0;
  let orderDiscountRule = null;
  let appliedOrderDiscounts = [];

  if (orderDiscountResult) {
    orderDiscountAmount = orderDiscountResult.amount;
    const mainRule = orderDiscountResult.rule;

    if (orderDiscountResult.isCombinable && orderDiscountResult.combinedRules) {
      appliedOrderDiscounts = orderDiscountResult.combinedRules.map(r => ({
        ...r,
        ruleId: r.id,
        amount: r._calculatedImpact,
        type: 'ORDER',
      }));

      orderDiscountRule = {
        ruleId: mainRule.id,
        amount: orderDiscountAmount,
        isCombinable: true,
        combinedCount: orderDiscountResult.combinedRules.length,
      };
    } else {
      orderDiscountRule = {
        ruleId: mainRule.id,
        amount: orderDiscountAmount,
        isCombinable: false,
      };

      appliedOrderDiscounts.push({
        ...mainRule,
        ruleId: mainRule.id,
        amount: orderDiscountAmount,
        type: 'ORDER',
      });
    }
  }

  // Paso 6: Calcular totales finales
  const finalTotal = toNumber(D.max(money(residualSubtotal).minus(orderDiscountAmount), money(GUARD_MIN_PRICE)));
  const discountTotal = toNumber(money(originalTotal).minus(finalTotal));

  // Paso 7: Compilar resultados
  const appliedDiscounts = itemsWithDiscounts
    .filter(item => item.appliedRule)
    .map(item => ({
      ruleId: item.appliedRule.ruleId,
      productId: item.productId,
      quantity: item.discountableQuantity,
      amount: item.discountAmount,
      type: 'ITEM',
    }));

  // Agregar descuentos ORDER (puede ser uno o varios si son combinables)
  if (appliedOrderDiscounts.length > 0) {
    appliedDiscounts.push(...appliedOrderDiscounts);
  }

  return {
    originalTotal,
    discountTotal,
    finalTotal,
    appliedDiscounts,
    items: itemsWithDiscounts,
    orderDiscount: orderDiscountRule,
  };
}

module.exports = {
  filterByVigency,
  splitByLayer,
  validateTicketConditions,
  filterOrderRulesByTicketConditions,
  evaluateUniversal,
  validatePaymentBreakdownAmounts,
};
