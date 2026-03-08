const prisma = require('../db/database.prisma');

const openRegister = async (data, user) => {
    // Regla: solo puede existir una caja abierta por tienda al mismo tiempo
    const existingOpen = await prisma.cashRegister.findFirst({
        where: { storeId: user.storeId, status: 'OPEN' }
    });

    if (existingOpen) {
        throw new Error('Ya existe una caja abierta en esta tienda.');
    }

    const { openingAmount } = data;

    const caja = await prisma.cashRegister.create({
        data: {
            storeId: user.storeId,
            openedByUserId: user.id,
            openingAmount: parseFloat(openingAmount),
            status: 'OPEN'
        }
    });

    return caja;
};

const closeRegister = async (data, user) => {
    const { closingAmount } = data;

    const openRegister = await prisma.cashRegister.findFirst({
        where: { storeId: user.storeId, status: 'OPEN' }
    });

    if (!openRegister) {
        throw new Error('No hay ninguna caja abierta en esta tienda para cerrar.');
    }

    // Calcular el expected amount: openingAmount + order sales + income movements - expense movements
    
    // 1. Obtener ordenes pagadas durante la caja
    const orders = await prisma.order.findMany({
        where: { cashRegisterId: openRegister.id, statusPayment: 'paid' }
    });
    
    const ordersTotal = orders.reduce((sum, order) => sum + order.amoutPayed, 0);

    // 2. Obtener movimientos de caja manuales
    const movements = await prisma.cashMovement.findMany({
        where: { cashRegisterId: openRegister.id }
    });

    const income = movements.filter(m => m.type === 'INCOME').reduce((sum, m) => sum + m.amount, 0);
    const expense = movements.filter(m => m.type === 'EXPENSE').reduce((sum, m) => sum + m.amount, 0);

    const expectedAmount = openRegister.openingAmount + ordersTotal + income - expense;
    const difference = parseFloat(closingAmount) - expectedAmount;

    const closedCaja = await prisma.cashRegister.update({
        where: { id: openRegister.id },
        data: {
            status: 'CLOSED',
            closedByUserId: user.id,
            closedAt: new Date(),
            closingAmount: parseFloat(closingAmount),
            expectedAmount: expectedAmount,
            difference: difference
        }
    });

    return closedCaja;
};

const getCurrentRegister = async (user) => {
    const openRegister = await prisma.cashRegister.findFirst({
        where: { storeId: user.storeId, status: 'OPEN' },
        include: { openedByUser: true }
    });
    return openRegister; // Puede ser null si no hay caja abierta
};

module.exports = { openRegister, closeRegister, getCurrentRegister };
