const prisma = require('../db/database.prisma');
const bcrypt = require('bcrypt');
const { money, round, sum } = require('../utils/money');

const MAX_DAYS = 30;
const DEFAULT_DAYS = 7;

function buildDateRange(startDate, endDate) {
    const now = new Date();
    let start, end;

    if (startDate) {
        start = new Date(`${startDate}T00:00:00`);
    } else {
        start = new Date(now);
        start.setDate(start.getDate() - DEFAULT_DAYS);
        start.setHours(0, 0, 0, 0);
    }

    if (endDate) {
        end = new Date(`${endDate}T23:59:59.999`);
    } else {
        end = new Date(now);
        end.setHours(23, 59, 59, 999);
    }

    // Validate range (max 30 days)
    const diffDays = (end - start) / (1000 * 60 * 60 * 24);
    if (diffDays > MAX_DAYS) {
        return { error: `El período máximo permitido es de ${MAX_DAYS} días.` };
    }

    return { start, end };
}

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

    if (!user.storeId) {
        throw new Error('No tienes una tienda asignada para operar la caja.');
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
            store: { connect: { id: user.storeId } },
            openedByUser: { connect: { id: user.id } },
            openingAmount: round(openingAmount),
            status: 'OPEN',
            observation: user.isSimulating ? 'Apertura Simulada por SISTEMA' : null
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

    if (!user.storeId) {
        throw new Error('No tienes una tienda asignada para cerrar la caja de esta sucursal.');
    }

    const openRegister = await prisma.cashRegister.findFirst({
        where: { storeId: user.storeId, status: 'OPEN' }
    });

    if (!openRegister) {
        throw new Error('No hay ninguna caja abierta en esta tienda para cerrar.');
    }

    // Calcular el expected amount: openingAmount + order sales + income movements - expense movements
    
    // 1. Obtener ordenes vinculadas a esta caja (todas las que no estén canceladas)
    const orders = await prisma.order.findMany({
        where: { 
            cashRegisterId: openRegister.id, 
            status: { not: 'CANCELLED' } 
        },
        include: { orderPayments: true }
    });
    
    // Solo sumamos el efectivo para el arqueo de caja física
    const ordersTotalEfectivo = sum(orders, (order) => {
        // Si hay desglose de pagos, sumamos solo lo que fue en efectivo
        if (order.orderPayments && order.orderPayments.length > 0) {
            return sum(
                order.orderPayments.filter(p => p.paymentMethod.toLowerCase() === 'efectivo'),
                p => p.amount
            );
        }
        // Fallback para órdenes antiguas sin desglose
        const isEfectivo = !order.paymentMethod || order.paymentMethod.toLowerCase() === 'efectivo';
        return isEfectivo ? order.amoutPayed : 0;
    });

    // 2. Obtener movimientos de caja manuales
    const movements = await prisma.cashMovement.findMany({
        where: { cashRegisterId: openRegister.id }
    });

    const income = sum(movements.filter(m => m.type === 'INCOME'), m => m.amount);
    const expense = sum(movements.filter(m => m.type === 'EXPENSE'), m => m.amount);

    // El monto esperado físico es: apertura + ventas en efectivo + ingresos manuales - retiros manuales
    const expectedAmount = round(
        money(openRegister.openingAmount).plus(ordersTotalEfectivo).plus(income).minus(expense)
    );
    const difference = round(money(closingAmount).minus(expectedAmount));

    const closedCaja = await prisma.cashRegister.update({
        where: { id: openRegister.id },
        data: {
            status: 'CLOSED',
            closedByUser: { connect: { id: user.id } },
            closedAt: new Date(),
            closingAmount: round(closingAmount),
            expectedAmount: expectedAmount,
            difference: difference,
            observation: user.isSimulating
                ? `${observation || ''} (Simulada por SISTEMA)`.trim()
                : (observation || null)
        }
    });

    return closedCaja;
};

const getCurrentRegister = async (user) => {
    if (!user.storeId) return null; // Prevenir crash de Prisma si el usuario no tiene tienda
    
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
            },
            orderPayments: true
        }
        // NOTA: incluimos TODAS las órdenes (incluso CANCELLED) para auditoría,
        // pero mandamos el status para que el frontend las excluya de los totales.
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

const getGlobalHistory = async (user, query = {}) => {
    const { startDate, endDate } = query;
    const range = buildDateRange(startDate, endDate);

    if (range.error) {
        throw new Error(range.error);
    }

    const whereClause = {
        ...(user.storeId ? { storeId: user.storeId } : {}),
        createdAt: { gte: range.start, lte: range.end }
    };

    const orders = await prisma.order.findMany({
        where: {
            ...whereClause,
            orderDate: { gte: range.start, lte: range.end } // Specifically for orders if orderDate is preferred
        },
        include: { 
            user: true, 
            client: true,
            orderDetails: {
                include: { product: true }
            },
            orderPayments: true,
            appliedDiscounts: true
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

const getAllRegisters = async (user, query = {}) => {
    const { startDate, endDate } = query;
    const range = buildDateRange(startDate, endDate);

    // SISTEMA puede ver todos los registros si no hay override de tienda
    const isSistema = user.role === 'SISTEMA' || user.isSistema;
    const canSeeAll = isSistema && !user.isGlobalOverride;

    const whereClause = {
        ...(canSeeAll ? {} : (user.storeId ? { storeId: user.storeId } : {})),
        openedAt: { gte: range.start, lte: range.end },
    };

    const registers = await prisma.cashRegister.findMany({
        where: whereClause,
        orderBy: { openedAt: 'desc' },
        include: {
            openedByUser: true,
            closedByUser: true,
            orders: {
                where: { status: { not: 'CANCELLED' } },
                include: { orderPayments: true }
            },
            cashMovements: true
        }
    });

    // Map through the registers to calculate the totals per payment method
    const mappedRegisters = registers.map(reg => {
        let totalEfectivo = money(0);
        let totalTransferencia = money(0);
        let totalTarjeta = money(0);
        let totalCuentaCorriente = money(0);

        reg.orders.forEach(order => {
            // Si la orden tiene desglose de pagos (OrderPayment), sumamos cada uno a su categoría
            if (order.orderPayments && order.orderPayments.length > 0) {
                order.orderPayments.forEach(p => {
                    const method = p.paymentMethod.toLowerCase();
                    if (method === 'efectivo') totalEfectivo = totalEfectivo.plus(p.amount);
                    else if (method === 'transferencia') totalTransferencia = totalTransferencia.plus(p.amount);
                    else if (method === 'tarjeta') totalTarjeta = totalTarjeta.plus(p.amount);
                    else if (method === 'cuenta_corriente') totalCuentaCorriente = totalCuentaCorriente.plus(p.amount);
                    else totalEfectivo = totalEfectivo.plus(p.amount);
                });
            } else {
                // Fallback para órdenes antiguas basadas únicamente en paymentMethod
                const method = order.paymentMethod ? order.paymentMethod.toLowerCase() : 'efectivo';
                if (method === 'efectivo') totalEfectivo = totalEfectivo.plus(order.amoutPayed);
                else if (method === 'transferencia') totalTransferencia = totalTransferencia.plus(order.amoutPayed);
                else if (method === 'tarjeta') totalTarjeta = totalTarjeta.plus(order.amoutPayed);
                else if (method === 'cuenta_corriente') totalCuentaCorriente = totalCuentaCorriente.plus(order.amoutToPaid);
                else totalEfectivo = totalEfectivo.plus(order.amoutPayed);
            }
        });

        const totalIncome = sum(reg.cashMovements.filter(m => m.type === 'INCOME'), m => m.amount);
        const totalExpense = sum(reg.cashMovements.filter(m => m.type === 'EXPENSE'), m => m.amount);

        return {
            ...reg,
            totals: {
                ventasEfectivo: totalEfectivo,
                ventasTransferencia: totalTransferencia,
                ventasTarjeta: totalTarjeta,
                ventasCuentaCorriente: totalCuentaCorriente,
                ingresosManuales: totalIncome,
                retirosManuales: totalExpense
            }
        };
    });

    return mappedRegisters;
};

module.exports = { openRegister, closeRegister, getCurrentRegister, getRegisterHistory, getGlobalHistory, getAllRegisters };
