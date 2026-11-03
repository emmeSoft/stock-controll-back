const prisma = require('../db/database.prisma');
const cajaServices = require('./cajaServices');
const { round, isPositiveAmount } = require('../utils/money');

const createMovement = async (data, user) => {
    // Regla: los movimientos se asocian a la caja ABIERTA de la tienda
    const currentRegister = await cajaServices.getCurrentRegister(user);

    if (!currentRegister) {
        throw new Error('No puedes registrar un movimiento porque no hay ninguna caja abierta.');
    }

    const { type, amount, description, reference } = data;

    if (!['INCOME', 'EXPENSE'].includes(type)) {
        throw new Error('El tipo de movimiento debe ser INCOME o EXPENSE');
    }

    if (!isPositiveAmount(amount)) {
        throw Object.assign(new Error('El monto del movimiento debe ser un número positivo y finito.'), { status: 400 });
    }

    // $transaction nueva (createMovement no tenía ninguna): la guarda
    // atómica necesita retener el lock de CashRegister hasta que el
    // cashMovement.create commitee, y debe ser el PRIMER write de la
    // transacción (design.md Decisión 2) — antes del insert de
    // cashMovement, que toma un lock implícito FOR KEY SHARE sobre la fila
    // referenciada por la FK.
    const movement = await prisma.$transaction(async (tx) => {
        await cajaServices.assertRegisterOpen(
            tx,
            currentRegister.id,
            'La caja se cerró mientras confirmabas el movimiento. Abrí la caja de nuevo para continuar.'
        );

        return await tx.cashMovement.create({
            data: {
                store: { connect: { id: user.storeId } },
                cashRegister: { connect: { id: currentRegister.id } },
                user: { connect: { id: user.id } },
                type: type,
                amount: round(amount),
                description: user.isSimulating
                    ? `${description || ''} (Simulada por SISTEMA)`.trim()
                    : (description || null),
                reference: reference || null
            }
        });
    });

    return movement;
};

const getMovementsByRegister = async (cashRegisterId, user) => {
    // Ensure the user has access to this register's store
    const register = await prisma.cashRegister.findUnique({
        where: { id: cashRegisterId }
    });

    if (!register || (user.storeId && register.storeId !== user.storeId)) {
        throw new Error('Caja no encontrada o acceso denegado.');
    }

    const movements = await prisma.cashMovement.findMany({
        where: { cashRegisterId: cashRegisterId },
        include: { user: true },
        orderBy: { createdAt: 'desc' }
    });

    return movements;
};

module.exports = { createMovement, getMovementsByRegister };
