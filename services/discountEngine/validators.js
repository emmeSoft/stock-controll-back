/**
 * validators.js
 * ─────────────────────────────────────────────────────────────────
 * Valida el campo `conditions` JSON según el DiscountType.
 * AXIOMA 14: Conditions inválidas → skip con warning. Pipeline nunca crashea.
 * ─────────────────────────────────────────────────────────────────
 */

const VALIDATORS = {
  /**
   * { minQuantity: Int (>=1), productId?: String, categoryId?: String }
   */
  QUANTITY(c) {
    if (typeof c.minQuantity !== 'number' || !Number.isInteger(c.minQuantity) || c.minQuantity < 1)
      return 'minQuantity debe ser un entero >= 1';
    return null;
  },

  /**
   * { paymentMethods: String[] (non-empty) }
   */
  CASH_PAYMENT(c) {
    if (!Array.isArray(c.paymentMethods) || c.paymentMethods.length === 0)
      return 'paymentMethods debe ser un array no vacío';
    if (c.paymentMethods.some(m => typeof m !== 'string'))
      return 'paymentMethods debe contener solo strings';
    return null;
  },

  /**
   * { clientIds?: String[], allClients?: Boolean }
   * Al menos uno de los dos debe estar presente.
   */
  CLIENT(c) {
    if (!c.allClients && (!Array.isArray(c.clientIds) || c.clientIds.length === 0))
      return 'CLIENT requiere clientIds (String[]) o allClients: true';
    return null;
  },

  /**
   * SPECIAL_DATE no requiere conditions propias:
   * la vigencia temporal se controla con startsAt/endsAt del modelo.
   */
  SPECIAL_DATE(_c) {
    return null;
  },

  /**
   * { productIds: String[] (non-empty) }
   */
  PRODUCT(c) {
    if (!Array.isArray(c.productIds) || c.productIds.length === 0)
      return 'productIds debe ser un array no vacío';
    return null;
  },

  /**
   * { categoryIds: String[] (non-empty) }
   */
  CATEGORY(c) {
    if (!Array.isArray(c.categoryIds) || c.categoryIds.length === 0)
      return 'categoryIds debe ser un array no vacío';
    return null;
  },

  /**
   * { minAmount: Float (>0) }
   */
  MIN_AMOUNT(c) {
    if (typeof c.minAmount !== 'number' || c.minAmount <= 0)
      return 'minAmount debe ser un número > 0';
    return null;
  },

  /**
   * { productIds: String[] (non-empty), maxUnits: Int (>=1) }
   */
  LIMITED_STOCK(c) {
    if (!Array.isArray(c.productIds) || c.productIds.length === 0)
      return 'productIds debe ser un array no vacío';
    if (typeof c.maxUnits !== 'number' || !Number.isInteger(c.maxUnits) || c.maxUnits < 1)
      return 'maxUnits debe ser un entero >= 1';
    return null;
  },
};

/**
 * @param {string} type
 * @param {object} conditions
 * @returns {string|null} — error message or null if valid
 */
function validateConditions(type, conditions) {
  const validator = VALIDATORS[type];
  if (!validator) return `No existe validador para el tipo: ${type}`;
  if (!conditions || typeof conditions !== 'object') return 'conditions debe ser un objeto';
  try {
    return validator(conditions);
  } catch (err) {
    return `Error de validación para tipo ${type}: ${err.message}`;
  }
}

// ─────────────────────────────────────────────────────────────────
// Validación Dual: legacy vs universal
// ─────────────────────────────────────────────────────────────────

const UNIVERSAL_SCHEMA = {
  target: {
    productIds: (v) => Array.isArray(v) ? null : 'productIds debe ser array',
    categoryIds: (v) => Array.isArray(v) ? null : 'categoryIds debe ser array',
  },
  ticketConditions: {
    paymentMethods: (v) => (Array.isArray(v) || !v) ? null : 'paymentMethods debe ser array',
    minAmount: (v) => (typeof v === 'number' || !v) ? null : 'minAmount debe ser número',
    allClients: (v) => (typeof v === 'boolean' || !v) ? null : 'allClients debe ser boolean',
    clientIds: (v) => (Array.isArray(v) || !v) ? null : 'clientIds debe ser array',
  },
  itemConditions: {
    minQuantity: (v) => (typeof v === 'number' || !v) ? null : 'minQuantity debe ser número',
  },
  constraints: {
    maxUnits: (v) => (typeof v === 'number' || !v) ? null : 'maxUnits debe ser número',
  },
};

/**
 * Valida conditions para reglas universales.
 * @param {object} conditions - conditionsUniversal
 * @returns {string|null} - error message or null if valid
 */
function validateConditionsUniversal(conditions) {
  if (!conditions || typeof conditions !== 'object') {
    return 'conditionsUniversal debe ser un objeto';
  }

  // Validar target
  if (conditions.target !== undefined && conditions.target !== null) {
    if (typeof conditions.target !== 'object') {
      return 'target debe ser un objeto';
    }
    const { productIds, categoryIds } = conditions.target;
    if (productIds !== undefined) {
      const err = UNIVERSAL_SCHEMA.target.productIds(productIds);
      if (err) return `target.productIds: ${err}`;
    }
    if (categoryIds !== undefined) {
      const err = UNIVERSAL_SCHEMA.target.categoryIds(categoryIds);
      if (err) return `target.categoryIds: ${err}`;
    }
  }

  // Validar ticketConditions
  if (conditions.ticketConditions) {
    if (typeof conditions.ticketConditions !== 'object') {
      return 'ticketConditions debe ser un objeto';
    }
    const tc = conditions.ticketConditions;
    for (const [key, validator] of Object.entries(UNIVERSAL_SCHEMA.ticketConditions)) {
      if (tc[key] !== undefined) {
        const err = validator(tc[key]);
        if (err) return `ticketConditions.${key}: ${err}`;
      }
    }
  }

  // Validar itemConditions
  if (conditions.itemConditions) {
    if (typeof conditions.itemConditions !== 'object') {
      return 'itemConditions debe ser un objeto';
    }
    const ic = conditions.itemConditions;
    for (const [key, validator] of Object.entries(UNIVERSAL_SCHEMA.itemConditions)) {
      if (ic[key] !== undefined) {
        const err = validator(ic[key]);
        if (err) return `itemConditions.${key}: ${err}`;
      }
    }
  }

  // Validar constraints
  if (conditions.constraints) {
    if (typeof conditions.constraints !== 'object') {
      return 'constraints debe ser un objeto';
    }
    const c = conditions.constraints;
    for (const [key, validator] of Object.entries(UNIVERSAL_SCHEMA.constraints)) {
      if (c[key] !== undefined) {
        const err = validator(c[key]);
        if (err) return `constraints.${key}: ${err}`;
      }
    }
  }

  return null;
}

/**
 * Valida conditions según el engineVersion de la regla.
 * @param {object} conditions - conditions o conditionsUniversal
 * @param {string} engineVersion - "legacy" o "universal"
 * @param {string} [type] - tipo legacy (requerido si engineVersion="legacy")
 * @returns {string|null} - error message or null if valid
 */
function validateConditionsDual(conditions, engineVersion, type) {
  if (engineVersion === 'universal') {
    return validateConditionsUniversal(conditions);
  }
  
  // Legacy: delegar al validador existente
  if (engineVersion === 'legacy' || !engineVersion) {
    if (!type) {
      return 'type es requerido para engineVersion legacy';
    }
    return validateConditions(type, conditions);
  }
  
  return `engineVersion desconocido: ${engineVersion}`;
}

module.exports = { 
  validateConditions,
  validateConditionsUniversal,
  validateConditionsDual,
};
