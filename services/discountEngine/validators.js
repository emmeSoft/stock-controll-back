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

module.exports = { validateConditions };
