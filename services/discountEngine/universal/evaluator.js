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
function validateTicketConditions(ticketConditions, context) {
  if (!ticketConditions) return true;
  
  const { paymentMethods, minAmount, allClients, clientIds } = ticketConditions;
  
  // paymentMethods: si está definido, debe cumplir al menos uno
  if (paymentMethods?.length > 0) {
    const hasPaymentMatch = paymentMethods.some(pm => 
      context.paymentMethods?.includes(pm)
    );
    if (!hasPaymentMatch) return false;
  }
  
  // minAmount: si está definido, el subtotal debe ser >= minAmount
  if (minAmount > 0 && context.orderSubtotal < minAmount) {
    return false;
  }
  
  // allClients: si es true, cualquier cliente aplica
  if (allClients === true) return true;
  
  // clientIds: si está definido, el cliente debe estar en la lista
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
    return validateTicketConditions(conditions.ticketConditions, context);
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
  
  // Preparar items con originalSubtotal calculado
  const itemsWithSubtotal = items.map(item => ({
    ...item,
    originalSubtotal: item.originalSubtotal ?? (item.unitPrice * item.quantity),
  }));
  
  // Paso 1: Filtrar por vigencia
  const vigenteRules = filterByVigency(rules, now);
  
  // Paso 2: Separar por capa
  const { itemRules, orderRules } = splitByLayer(vigenteRules);
  
  // Calcular subtotal original
  const originalTotal = itemsWithSubtotal.reduce((sum, item) => {
    return sum + item.originalSubtotal;
  }, 0);
  
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
      const originalSubtotal = item.originalSubtotal ?? (item.unitPrice * item.quantity);
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
      // AXIOMA: Las reglas combinables se aplican de forma iterativa (en cascada)
      // para que el desglose refleje el impacto REAL de cada una. (SC-2.2)
      let tempTotal = residualSubtotal;
      appliedOrderDiscounts = orderDiscountResult.combinedRules.map(r => {
        const impact = parseFloat((tempTotal * ((r.percentage ?? 0) / 100)).toFixed(2));
        tempTotal -= impact;
        return {
          ruleId: r.id,
          amount: impact,
          type: 'ORDER',
        };
      });
      
      orderDiscountRule = {
        ruleId: mainRule.id,
        amount: orderDiscountAmount,
        isCombinable: true,
        combinedCount: orderDiscountResult.combinedRules.length,
      };
    } else {
      // Solo una regla (no combinable)
      orderDiscountRule = {
        ruleId: mainRule.id,
        amount: orderDiscountAmount,
        isCombinable: false,
      };
      
      appliedOrderDiscounts.push({
        ruleId: mainRule.id,
        amount: orderDiscountAmount,
        type: 'ORDER',
      });
    }
  }
  
  // Paso 6: Calcular totales finales
  const finalTotal = Math.max(residualSubtotal - orderDiscountAmount, GUARD_MIN_PRICE);
  const discountTotal = originalTotal - finalTotal;
  
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
};
