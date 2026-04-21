/**
 * validators.js — Universal Discount Engine
 * ─────────────────────────────────────────────────────────────────
 * Validación de conditions para reglas universales.
 * AXIOMA 14: Conditions inválidas → skip con warning. Pipeline nunca crashea.
 * ─────────────────────────────────────────────────────────────────
 */

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
  // ─── Universal: requiere conditionsUniversal ────────────────────────────
  if (engineVersion === 'universal') {
    // type y conditions son opcionales para universal (legacy fields deprecados)
    if (!conditions || (typeof conditions !== 'object')) {
      return 'conditionsUniversal es requerido para engineVersion universal';
    }
    return validateConditionsUniversal(conditions);
  }
  
  // ─── Legacy: soporta los campos old o los nuevos para backward compat ───
  if (engineVersion === 'legacy' || !engineVersion) {
    // Legacy permite ambos: conditions (old) o conditionsUniversal (new path)
    if (conditions && typeof conditions === 'object') {
      // Tiene conditions legacy
      if (!type) {
        return null; // Admitimos rules sin type por backward-compat
      }
      return validateConditions(type, conditions);
    }
    
    // También accepta conditionsUniversal como alternativa legacy
    if (conditions && conditions.target !== undefined) {
      return validateConditionsUniversal(conditions);
    }
    
    return null; // Permitimos creación sin conditions por backward-compat
  }
  
  return `engineVersion desconocido: ${engineVersion}`;
}

/**
 * Validates conditions for legacy rules (backward compatibility).
 * Legacy rules are accepted as-is without strict validation.
 * @param {string} type - legacy type (not used)
 * @param {object} conditions - conditions object
 * @returns {string|null} - error message or null if valid
 */
function validateConditions(type, conditions) {
  // Legacy rules are accepted as-is for backward compatibility
  // The old VALIDATORS object has been removed
  if (!conditions || typeof conditions !== 'object') {
    return 'conditions debe ser un objeto';
  }
  return null; // Accept all legacy conditions as-is
}

/**
 * Legacy validator wrapper - accepts any conditions for backward compat.
 * @param {object} conditions 
 * @returns {string|null}
 */
function validateDiscountRule(conditions) {
  // Accept any conditions object for backward compatibility
  // The new universal validation handles the new schema
  if (conditions && typeof conditions !== 'object') {
    return 'conditions debe ser un objeto';
  }
  return null;
}

module.exports = { 
  validateConditions,
  validateConditionsUniversal,
  validateConditionsDual,
  validateDiscountRule,
};
