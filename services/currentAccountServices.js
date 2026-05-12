/**
 * currentAccountServices.js
 * ─────────────────────────────────────────────────────────────────
 * Lógica de negocio para el módulo de Cuentas Corrientes.
 *
 * REGLAS CLAVE:
 *  - Solo un account por cliente/tienda (enforced por @unique en schema).
 *  - Las actualizaciones de saldo son SIEMPRE atómicas (dentro de transacciones Prisma).
 *  - Un pago a cuenta corriente SIEMPRE genera un INCOME en la caja activa.
 *  - Solo se puede cerrar una cuenta con balance = 0.
 * ─────────────────────────────────────────────────────────────────
 */

const prisma        = require('../db/database.prisma');
const cajaServices  = require('./cajaServices');

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

/**
 * Busca la cuenta corriente activa de un cliente en la tienda del usuario.
 * Lanza error si no existe o está cerrada.
 */
async function requireOpenAccount(clientId, storeId) {
  const account = await prisma.currentAccount.findFirst({
    where: { clientId, storeId },
    include: { client: { select: { firstName: true, lastName: true } } }
  });

  if (!account) {
    throw Object.assign(
      new Error('El cliente no tiene una cuenta corriente en esta tienda.'),
      { status: 404 }
    );
  }
  if (account.status !== 'OPEN') {
    throw Object.assign(
      new Error('La cuenta corriente de este cliente está cerrada.'),
      { status: 400 }
    );
  }
  return account;
}

// ─────────────────────────────────────────────────────────────────
// open
// ─────────────────────────────────────────────────────────────────

/**
 * Abre una cuenta corriente para un cliente existente.
 * Solo puede hacerlo quien tenga el permiso account.open.
 */
const open = async (clientId, user) => {
  const storeId = user.storeId;
  if (!storeId) throw Object.assign(new Error('No tenés tienda asignada.'), { status: 400 });

  // Verificar que el cliente existe y pertenece a la tienda
  const client = await prisma.client.findFirst({
    where: { id: clientId, storeId },
    select: { id: true, firstName: true, lastName: true, isActive: true },
  });
  if (!client) throw Object.assign(new Error('Cliente no encontrado.'), { status: 404 });
  if (!client.isActive) throw Object.assign(new Error('No se puede abrir cuenta a un cliente dado de baja.'), { status: 400 });

  // Verificar si ya tiene cuenta (abierta o cerrada)
  const existing = await prisma.currentAccount.findFirst({ where: { clientId, storeId } });
  if (existing) {
    if (existing.status === 'OPEN') {
      throw Object.assign(new Error('Este cliente ya tiene una cuenta corriente abierta.'), { status: 409 });
    }
    // Si estaba CERRADA, la reabrimos
    const reopened = await prisma.currentAccount.update({
      where: { id: existing.id },
      data:  { status: 'OPEN', balance: 0, openedAt: new Date(), closedAt: null },
      include: { client: { select: { firstName: true, lastName: true } } },
    });
    return reopened;
  }

  const account = await prisma.currentAccount.create({
    data: {
      client:  { connect: { id: clientId } },
      store:   { connect: { id: storeId } },
      balance: 0,
      status:  'OPEN',
    },
    include: { client: { select: { firstName: true, lastName: true } } },
  });

  return account;
};

// ─────────────────────────────────────────────────────────────────
// close
// ─────────────────────────────────────────────────────────────────

/**
 * Cierra una cuenta corriente. Solo si balance === 0.
 * Solo puede hacerlo ADMINISTRADOR o SISTEMA.
 */
const close = async (accountId, user) => {
  const where = { id: accountId };
  if (user.storeId) {
    where.storeId = user.storeId;
  } else if (!user.isSistema) {
    throw Object.assign(new Error('Debe seleccionar una tienda para realizar esta acción.'), { status: 400 });
  }

  const account = await prisma.currentAccount.findFirst({
    where,
    include: { client: { select: { firstName: true, lastName: true } } },
  });

  if (!account) throw Object.assign(new Error('Cuenta corriente no encontrada.'), { status: 404 });
  if (account.status === 'CLOSED') throw Object.assign(new Error('La cuenta ya está cerrada.'), { status: 400 });
  if (account.balance !== 0) {
    throw Object.assign(
      new Error(`No se puede cerrar la cuenta. El cliente tiene un saldo pendiente de $${account.balance.toFixed(2)}.`),
      { status: 400 }
    );
  }

  const closed = await prisma.currentAccount.update({
    where: { id: accountId },
    data:  { status: 'CLOSED', closedAt: new Date() },
    include: { client: { select: { firstName: true, lastName: true } } },
  });

  return closed;
};

// ─────────────────────────────────────────────────────────────────
// getList
// ─────────────────────────────────────────────────────────────────

/**
 * Lista todas las cuentas corrientes de la tienda.
 * Opcionalmente filtradas por status.
 */
const getList = async (user, { status } = {}) => {
  const where = {};
  
  if (user.storeId) {
    where.storeId = user.storeId;
  } else if (!user.isSistema) {
    // Si no hay storeId y no es SISTEMA, es un error de contexto
    throw Object.assign(new Error('Debe seleccionar una tienda para ver las cuentas corrientes.'), { status: 400 });
  }
  // Si es SISTEMA y no hay storeId, 'where.storeId' no se agrega y trae todo.

  if (status) where.status = status;

  const accounts = await prisma.currentAccount.findMany({
    where,
    include: {
      client: {
        select: { id: true, firstName: true, lastName: true, dni: true, phoneNumber: true },
      },
      _count: { select: { movements: true } },
    },
    orderBy: [{ status: 'asc' }, { client: { lastName: 'asc' } }],
  });

  return accounts;
};

// ─────────────────────────────────────────────────────────────────
// getByClient
// ─────────────────────────────────────────────────────────────────

/**
 * Devuelve la cuenta corriente de un cliente específico (para el panel de cliente).
 */
const getByClient = async (clientId, user) => {
  const where = { clientId };
  if (user.storeId) {
    where.storeId = user.storeId;
  } else if (!user.isSistema) {
    throw Object.assign(new Error('Debe seleccionar una tienda para realizar esta acción.'), { status: 400 });
  }

  const account = await prisma.currentAccount.findFirst({
    where,
    include: {
      client: { select: { firstName: true, lastName: true, dni: true } },
      movements: {
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: {
          user: { select: { firstName: true, lastName: true } },
          order: { select: { id: true, orderDate: true } },
        },
      },
    },
  });

  return account || null;
};

// ─────────────────────────────────────────────────────────────────
// getDetail
// ─────────────────────────────────────────────────────────────────

/**
 * Detalle completo de una cuenta corriente con historial paginado.
 */
const getDetail = async (accountId, user) => {
  const where = { id: accountId };
  if (user.storeId) {
    where.storeId = user.storeId;
  } else if (!user.isSistema) {
    throw Object.assign(new Error('Debe seleccionar una tienda para realizar esta acción.'), { status: 400 });
  }

  const account = await prisma.currentAccount.findFirst({
    where,
    include: {
      client: { select: { id: true, firstName: true, lastName: true, dni: true, phoneNumber: true } },
      movements: {
        orderBy: { createdAt: 'desc' },
        include: {
          user:  { select: { firstName: true, lastName: true } },
          order: { select: { id: true, orderDate: true, amount: true } },
        },
      },
    },
  });

  if (!account) throw Object.assign(new Error('Cuenta corriente no encontrada.'), { status: 404 });

  return account;
};

// ─────────────────────────────────────────────────────────────────
// registerPayment
// ─────────────────────────────────────────────────────────────────

/**
 * Registra un pago a una cuenta corriente existente.
 *
 * @param {object} data — { clientId, amount, paymentMethod, description? }
 * @param {object} user — usuario autenticado (req.user)
 *
 * Atomicidad: todo ocurre dentro de una $transaction.
 * Efectos:
 *   1. Decrementa balance de la CurrentAccount.
 *   2. Crea CurrentAccountMovement de tipo PAYMENT.
 *   3. Crea CashMovement de tipo INCOME en la caja activa.
 */
const registerPayment = async (data, user) => {
  const { clientId, amount, paymentMethod, description } = data;
  const storeId = user.storeId;

  if (!storeId) throw Object.assign(new Error('No tenés tienda asignada.'), { status: 400 });
  if (!amount || amount <= 0) throw Object.assign(new Error('El monto del pago debe ser mayor a cero.'), { status: 400 });
  if (!paymentMethod) throw Object.assign(new Error('Debe seleccionar un método de pago.'), { status: 400 });

  // Verificar caja abierta ANTES de la tx (falla rápido)
  const currentRegister = await cajaServices.getCurrentRegister(user);
  if (!currentRegister) {
    throw Object.assign(new Error('No se puede registrar un pago: Debe abrir una caja primero.'), { status: 400 });
  }

  // Obtener la cuenta antes de la tx para validar
  const accountPre = await requireOpenAccount(clientId, storeId);

  if (amount > accountPre.balance) {
    throw Object.assign(
      new Error(`El monto del pago ($${amount.toFixed(2)}) supera el saldo adeudado ($${accountPre.balance.toFixed(2)}).`),
      { status: 400 }
    );
  }

  // ── Transacción atómica ──────────────────────────────────────
  const result = await prisma.$transaction(async (tx) => {

    // 1. Decrementar saldo
    const updatedAccount = await tx.currentAccount.update({
      where: { id: accountPre.id },
      data:  { balance: { decrement: amount } },
    });

    const balanceAfter = parseFloat(updatedAccount.balance.toFixed(2));

    // 2. Registrar movimiento en CurrentAccount
    const movement = await tx.currentAccountMovement.create({
      data: {
        currentAccount: { connect: { id: accountPre.id } },
        user:           { connect: { id: user.id } },
        type:           'PAYMENT',
        totalAmount:    amount,
        paidAmount:     amount,
        debtAmount:     -amount,    // negativo: reduce la deuda
        balanceAfter,
        description:    description || `Pago via ${paymentMethod}`,
      },
      include: {
        user: { select: { firstName: true, lastName: true } },
      },
    });

    // 3. Registrar INCOME en la caja activa
    const clientName = `${accountPre.client.firstName} ${accountPre.client.lastName}`;
    await tx.cashMovement.create({
      data: {
        store:        { connect: { id: storeId } },
        cashRegister: { connect: { id: currentRegister.id } },
        user:         { connect: { id: user.id } },
        type:         'INCOME',
        amount,
        description:  `Pago cuenta corriente (${clientName}) — ${paymentMethod}`,
        reference:    `CC-${accountPre.id}`,
      },
    });

    return { account: updatedAccount, movement };
  });

  return result;
};

// ─────────────────────────────────────────────────────────────────
// addSaleDebt  (llamado internamente desde salesServices)
// ─────────────────────────────────────────────────────────────────

/**
 * Agrega deuda a una cuenta corriente dentro de una transacción existente.
 * NO se usa directamente desde un controller — es un helper para salesServices.
 *
 * @param {PrismaTransaction} tx     — cliente de transacción de Prisma
 * @param {string}  orderId          — ID de la orden generada
 * @param {string}  clientId         — ID del cliente
 * @param {string}  storeId          — ID de la tienda
 * @param {string}  userId           — ID del vendedor
 * @param {number}  totalAmount      — Total de la venta (post-descuento)
 * @param {number}  paidAmount       — Lo que pagó en el momento
 */
const addSaleDebt = async (tx, { orderId, clientId, storeId, userId, totalAmount, paidAmount }) => {
  const debtAmount = parseFloat((totalAmount - paidAmount).toFixed(2));

  if (debtAmount < 0) {
    throw new Error('El monto pagado no puede superar el total de la venta en una cuenta corriente.');
  }

  // Buscar y bloquear la cuenta dentro de la tx
  const account = await tx.currentAccount.findFirst({
    where: { clientId, storeId, status: 'OPEN' },
  });

  if (!account) {
    throw Object.assign(
      new Error('El cliente no tiene cuenta corriente abierta en esta tienda.'),
      { status: 400 }
    );
  }

  // Incrementar saldo atómicamente
  const updatedAccount = await tx.currentAccount.update({
    where: { id: account.id },
    data:  { balance: { increment: debtAmount } },
  });

  const balanceAfter = parseFloat(updatedAccount.balance.toFixed(2));

  // Registrar movimiento de tipo SALE
  const movement = await tx.currentAccountMovement.create({
    data: {
      currentAccount: { connect: { id: account.id } },
      user:           { connect: { id: userId } },
      type:           'SALE',
      totalAmount,
      paidAmount,
      debtAmount,
      balanceAfter,
      order:          { connect: { id: orderId } },
      description:    `Venta — Pago parcial $${paidAmount.toFixed(2)} — Cargo $${debtAmount.toFixed(2)}`,
    },
  });

  return { account: updatedAccount, movement };
};

// ─────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────

module.exports = {
  open,
  close,
  getList,
  getByClient,
  getDetail,
  registerPayment,
  addSaleDebt,       // solo para uso interno desde salesServices
};
