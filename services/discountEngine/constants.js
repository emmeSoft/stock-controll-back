/**
 * constants.js
 * ─────────────────────────────────────────────────────────────────
 * Constantes del motor de descuentos.
 * ─────────────────────────────────────────────────────────────────
 */

// Prioridades default por tipo (diseño v3, sección 2.2).
// Al crear una regla sin prioridad explícita, se usa este valor.
const DEFAULT_PRIORITIES = {
  PRODUCT:       100,
  LIMITED_STOCK:  95,
  CLIENT:         90,
  QUANTITY:       80,
  CATEGORY:       70,
  SPECIAL_DATE:   50,
  MIN_AMOUNT:     40,
  CASH_PAYMENT:   30,
};

// Matriz de combinabilidad ORDER (AXIOMA 2).
// Define qué tipos ORDER se pueden combinar entre sí.
// Misma restricción en ambas direcciones (bidireccional).
const ORDER_COMBINABLE_TYPES = {
  CLIENT:       ['CASH_PAYMENT', 'SPECIAL_DATE', 'MIN_AMOUNT'],
  CASH_PAYMENT: ['CLIENT',       'SPECIAL_DATE', 'MIN_AMOUNT'],
  SPECIAL_DATE: ['CLIENT',       'CASH_PAYMENT', 'MIN_AMOUNT'],
  MIN_AMOUNT:   ['CLIENT',       'CASH_PAYMENT', 'SPECIAL_DATE'],
};

// AXIOMA 12: Ningún precio ni total puede bajar de este valor.
const GUARD_MIN_PRICE = 0.01;

// Tope global por defecto si la tienda no tiene uno configurado.
const DEFAULT_STORE_CAP_PCT = 50;

module.exports = {
  DEFAULT_PRIORITIES,
  ORDER_COMBINABLE_TYPES,
  GUARD_MIN_PRICE,
  DEFAULT_STORE_CAP_PCT,
};
