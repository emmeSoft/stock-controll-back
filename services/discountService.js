/**
 * discountService.js
 * ─────────────────────────────────────────────────────────────────
 * CRUD de DiscountRule + endpoint de preview.
 *
 * SEGURIDAD:
 *  - El `layer` siempre se deriva del `type` server-side (AXIOMA 1).
 *  - El `createdBy` viene del usuario autenticado, nunca del body.
 *  - El `usedUnits` es de solo lectura para el cliente.
 * ─────────────────────────────────────────────────────────────────
 */

const prisma              = require('../db/database.prisma.js');
const { validateConditions, getLayer, DEFAULT_PRIORITIES, runPipeline } = require('./discountEngine');

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

/**
 * Extrae solo los campos permitidos del body para crear/editar una regla.
 * Nunca acepta `layer`, `usedUnits`, `createdBy` del cliente.
 */
function sanitizeRuleInput(body) {
  const {
    name, description,
    type, percentage,
    startsAt, endsAt,
    conditions,
    priority,
    isCombinable,
    combinesWith,
    maxPercentage,
  } = body;
  return {
    name, description,
    type, percentage,
    startsAt: startsAt ? new Date(startsAt) : null,
    endsAt:   endsAt   ? new Date(endsAt)   : null,
    conditions,
    priority:       priority       ?? DEFAULT_PRIORITIES[type] ?? 0,
    isCombinable:   isCombinable   ?? true,
    combinesWith:   combinesWith   ?? [],
    maxPercentage:  maxPercentage  ?? null,
  };
}

/**
 * Valida un body de regla y lanza si hay errores.
 * @throws {Error}
 */
function validateRuleBody({ type, percentage, conditions }) {
  if (!type) throw new Error('El campo `type` es obligatorio.');
  if (typeof percentage !== 'number' || percentage <= 0 || percentage >= 100) {
    throw new Error('`percentage` debe ser un número entre 0.01 y 99.99.');
  }
  if (!conditions || typeof conditions !== 'object') {
    throw new Error('`conditions` debe ser un objeto.');
  }
  const condError = validateConditions(type, conditions);
  if (condError) throw new Error(`Conditions inválidas para tipo ${type}: ${condError}`);
}

// ─────────────────────────────────────────────────────────────────
// CRUD
// ─────────────────────────────────────────────────────────────────

/**
 * Lista todas las reglas de la tienda (activas + inactivas).
 */
const getAll = async (storeId) => {
  return prisma.discountRule.findMany({
    where:   { storeId },
    orderBy: [{ isActive: 'desc' }, { priority: 'desc' }, { createdAt: 'desc' }],
    include: { creator: { select: { id: true, fullName: true, email: true } } },
  });
};

/**
 * Obtiene una regla por ID, validando que pertenece a la tienda.
 */
const getById = async (id, storeId) => {
  const rule = await prisma.discountRule.findFirst({
    where:   { id, storeId },
    include: { creator: { select: { id: true, fullName: true, email: true } } },
  });
  if (!rule) throw new Error(`Regla de descuento '${id}' no encontrada.`);
  return rule;
};

/**
 * Crea una nueva regla de descuento.
 * El `layer` se deriva del `type` (AXIOMA 1), nunca del body.
 */
const create = async (body, user) => {
  const storeId = user.storeId;
  if (!storeId) throw new Error('El usuario no tiene tienda asignada.');

  validateRuleBody(body);

  const input = sanitizeRuleInput(body);
  const layer = getLayer(input.type); // AXIOMA 1: siempre derivado

  return prisma.discountRule.create({
    data: {
      storeId,
      createdBy: user.id,
      layer,           // nunca del cliente
      ...input,
    },
    include: { creator: { select: { id: true, fullName: true } } },
  });
};

/**
 * Actualiza una regla existente.
 * Si cambia el `type`, el `layer` se recalcula automáticamente.
 * `usedUnits` y `createdBy` no son modificables.
 */
const update = async (id, body, user) => {
  const storeId = user.storeId;
  await getById(id, storeId); // verifica ownership

  validateRuleBody(body);
  const input = sanitizeRuleInput(body);
  const layer = getLayer(input.type); // recalcular si cambió el tipo

  return prisma.discountRule.update({
    where: { id },
    data:  { layer, ...input },
    include: { creator: { select: { id: true, fullName: true } } },
  });
};

/**
 * Soft delete: desactiva una regla (isActive = false).
 * No elimina físicamente para preservar auditoría en AppliedDiscount.
 */
const deactivate = async (id, user) => {
  const storeId = user.storeId;
  await getById(id, storeId); // verifica ownership

  return prisma.discountRule.update({
    where: { id },
    data:  { isActive: false },
  });
};

/**
 * Reactiva una regla previamente desactivada.
 */
const activate = async (id, user) => {
  const storeId = user.storeId;
  await getById(id, storeId);

  return prisma.discountRule.update({
    where: { id },
    data:  { isActive: true },
  });
};

// ─────────────────────────────────────────────────────────────────
// Preview
// ─────────────────────────────────────────────────────────────────

/**
 * Calcula descuentos SIN persistir nada.
 * Usa exactamente el mismo motor que la venta real.
 *
 * @param {object} body — { items, clientId?, paymentMethods? }
 * @param {object} user — usuario autenticado
 */
const preview = async (body, user) => {
  const storeId = user.storeId;
  if (!storeId) throw new Error('El usuario no tiene tienda asignada.');

  const { items, clientId, paymentMethods } = body;

  if (!items || items.length === 0) {
    throw new Error('Se requiere al menos un item para el preview.');
  }

  // Leer precios reales de DB (nunca del frontend)
  const productIds = items.map(i => i.id ?? i.productId);
  const dbProducts = await prisma.product.findMany({
    where:  { id: { in: productIds }, storeId },
    select: { id: true, price: true, categoryId: true },
  });
  const productMap = new Map(dbProducts.map(p => [p.id, p]));

  const cartItems = items.map(item => {
    const pid     = item.id ?? item.productId;
    const product = productMap.get(pid);
    if (!product) throw new Error(`Producto '${pid}' no encontrado en esta tienda.`);
    return {
      productId:  pid,
      categoryId: product.categoryId ?? undefined,
      quantity:   item.quantity,
      unitPrice:  product.price,
    };
  });

  const store = await prisma.store.findUnique({
    where:  { id: storeId },
    select: { maxDiscountPct: true },
  });

  return runPipeline({
    storeId,
    prisma,
    store:          { maxDiscountPct: store?.maxDiscountPct ?? 50 },
    clientId:       clientId ?? null,
    paymentMethods: paymentMethods ?? [],
    items:          cartItems,
  });
};

module.exports = { getAll, getById, create, update, deactivate, activate, preview };
