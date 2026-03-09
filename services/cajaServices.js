const prisma = require('../db/database.prisma');
const bcrypt = require('bcrypt');

const openRegister = async (data, user) => {
    const { openingAmount, password } = data;

    if (!password) {
        throw new Error('Debe proporcionar su contraseña para abrir la caja.');
    }

    // Verify User Password
    const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
    const isPasswordValid = await bcrypt.compare(password, dbUser.password);
    
    if (!isPasswordValid) {
        throw new Error('Contraseña incorrecta. Acción denegada.');
    }

    // Regla: solo puede existir una caja abierta por tienda al mismo tiempo
    const existingOpen = await prisma.cashRegister.findFirst({
        where: { storeId: user.storeId, status: 'OPEN' }
    });

    if (existingOpen) {
        throw new Error('Ya existe una caja abierta en esta tienda.');
    }

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
    const { closingAmount, observation, password } = data;

    if (!password) {
        throw new Error('Debe proporcionar su contraseña para cerrar la caja.');
    }

    // Verify User Password
    const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
    const isPasswordValid = await bcrypt.compare(password, dbUser.password);
    
    if (!isPasswordValid) {
        throw new Error('Contraseña incorrecta. Acción denegada.');
    }

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
    
    // Solo sumamos el efectivo para el arqueo de caja física
    const ordersTotalEfectivo = orders
        .filter(o => !o.paymentMethod || o.paymentMethod.toLowerCase() === 'efectivo')
        .reduce((sum, order) => sum + order.amoutPayed, 0);

    // 2. Obtener movimientos de caja manuales
    const movements = await prisma.cashMovement.findMany({
        where: { cashRegisterId: openRegister.id }
    });

    const income = movements.filter(m => m.type === 'INCOME').reduce((sum, m) => sum + m.amount, 0);
    const expense = movements.filter(m => m.type === 'EXPENSE').reduce((sum, m) => sum + m.amount, 0);

    // El monto esperado físico es: apertura + ventas en efectivo + ingresos ingresos manuales - retiros manuales
    const expectedAmount = openRegister.openingAmount + ordersTotalEfectivo + income - expense;
    const difference = parseFloat(closingAmount) - expectedAmount;

    const closedCaja = await prisma.cashRegister.update({
        where: { id: openRegister.id },
        data: {
            status: 'CLOSED',
            closedByUserId: user.id,
            closedAt: new Date(),
            closingAmount: parseFloat(closingAmount),
            expectedAmount: expectedAmount,
            difference: difference,
            observation: observation || null
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

const getRegisterHistory = async (user) => {
    const register = await getCurrentRegister(user);
    if (!register) throw new Error("No hay caja abierta para mostrar el historial del turno.");

    const orders = await prisma.order.findMany({
        where: { cashRegisterId: register.id },
        include: { 
            user: true, 
            client: true,
            orderDetails: {
                include: { product: true }
            }
        }
    });

    const movements = await prisma.cashMovement.findMany({
        where: { cashRegisterId: register.id },
        include: { user: true }
    });

    const unified = [
        ...orders.map(o => ({ ...o, _typeModel: 'ORDER', date: o.orderDate || o.createdAt })),
        ...movements.map(m => ({ ...m, _typeModel: 'MOVEMENT', date: m.createdAt }))
    ].sort((a, b) => new Date(b.date) - new Date(a.date));

    return unified;
};

const getGlobalHistory = async (user) => {
    const whereClause = user.storeId ? { storeId: user.storeId } : {};

    const orders = await prisma.order.findMany({
        where: whereClause,
        include: { 
            user: true, 
            client: true,
            orderDetails: {
                include: { product: true }
            }
        }
    });

    const movements = await prisma.cashMovement.findMany({
        where: whereClause,
        include: { user: true }
    });

    const unified = [
        ...orders.map(o => ({ ...o, _typeModel: 'ORDER', date: o.orderDate || o.createdAt })),
        ...movements.map(m => ({ ...m, _typeModel: 'MOVEMENT', date: m.createdAt }))
    ].sort((a, b) => new Date(b.date) - new Date(a.date));

    return unified;
};

const getAllRegisters = async (user) => {
    const whereClause = user.storeId ? { storeId: user.storeId } : {};

    const registers = await prisma.cashRegister.findMany({
        where: whereClause,
        orderBy: { openedAt: 'desc' },
        include: {
            openedByUser: true,
            closedByUser: true,
            orders: {
                where: { statusPayment: 'paid' }
            },
            cashMovements: true
        }
    });

    // Map through the registers to calculate the totals per payment method
    const mappedRegisters = registers.map(reg => {
        let totalEfectivo = 0;
        let totalTransferencia = 0;
        let totalTarjeta = 0;

        reg.orders.forEach(order => {
            const method = order.paymentMethod ? order.paymentMethod.toLowerCase() : 'efectivo';
            if (method === 'efectivo') totalEfectivo += order.amoutPayed;
            else if (method === 'transferencia') totalTransferencia += order.amoutPayed;
            else if (method === 'tarjeta') totalTarjeta += order.amoutPayed;
            else totalEfectivo += order.amoutPayed; // Default to efectivo if unknown
        });

        const totalIncome = reg.cashMovements
            .filter(m => m.type === 'INCOME')
            .reduce((sum, m) => sum + m.amount, 0);

        const totalExpense = reg.cashMovements
            .filter(m => m.type === 'EXPENSE')
            .reduce((sum, m) => sum + m.amount, 0);

        return {
            ...reg,
            totals: {
                ventasEfectivo: totalEfectivo,
                ventasTransferencia: totalTransferencia,
                ventasTarjeta: totalTarjeta,
                ingresosManuales: totalIncome,
                retirosManuales: totalExpense
            }
        };
    });

    return mappedRegisters;
};

module.exports = { openRegister, closeRegister, getCurrentRegister, getRegisterHistory, getGlobalHistory, getAllRegisters };
