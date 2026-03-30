const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const cajaServices = require('./cajaServices');

const create = async (saleData, user) => {
  const { items, amount, clientId, paymentBreakdown } = saleData;

  // Determine effective storeId for the sale from the user's augmented context
  const effectiveStoreId = user.storeId;
  if (!effectiveStoreId) {
    throw new Error('Debe especificar una tienda para la venta.');
  }

  // Validate payment breakdown
  if (!paymentBreakdown || paymentBreakdown.length === 0) {
    throw new Error('Debe ingresar al menos un medio de pago.');
  }
  const totalPaid = paymentBreakdown.reduce((sum, p) => sum + p.amount, 0);
  if (Math.abs(totalPaid - amount) > 0.01) {
    throw new Error(`El total pagado (${totalPaid}) no coincide con el total de la venta (${amount}).`);
  }

  // Derive a summary paymentMethod string for the order
  const paymentMethodSummary = paymentBreakdown.length > 1
    ? 'COMBINADO'
    : paymentBreakdown[0].method;

  // VERIFICAR CLIENTE ACTIVO -> Regla de negocio.
  if (clientId) {
    const client = await prisma.client.findFirst({
      where: { id: clientId, storeId: effectiveStoreId }
    });
    if (client && client.isActive === false) {
      throw new Error('No se puede registrar la venta: El cliente seleccionado se encuentra dado de baja.');
    }
  }

  // VERIFICAR CAJA ABIERTA -> Regla de negocio.
  const currentRegister = await cajaServices.getCurrentRegister({ ...user, storeId: effectiveStoreId });
  if (!currentRegister) {
    throw new Error('No se puede registrar la venta: Debes abrir una caja primero en esta tienda.');
  }

  // Utilize a Prisma transaction to ensure atomicity
  return await prisma.$transaction(async (tx) => {
    // 1. Verify stock for all items
    for (const item of items) {
      const productWhere = user.storeId ? { id: item.id, storeId: user.storeId } : { id: item.id };
      const product = await tx.product.findFirst({
        where: productWhere
      });
      // Guardamos la información del stock anterior en el item para usarla después
      item.previousStock = product ? product.stock : 0;

      if (!product) {
        throw new Error(`Producto con ID ${item.id} no encontrado`);
      }

      if (product.stock < item.quantity) {
        throw new Error(`Stock insuficiente para el producto: ${product.name}. Stock actual: ${product.stock}, Solicitado: ${item.quantity}`);
      }
    }

    // 2. Create the order
    const order = await tx.order.create({
      data: {
        storeId: effectiveStoreId,
        userId: user.id || null,
        cashRegisterId: currentRegister.id,
        clientId: clientId || null,
        amount: amount,
        amoutPayed: amount,
        paymentMethod: paymentMethodSummary,
        status: "completed",
        statusPayment: "paid",
        orderDetails: {
          create: items.map(item => ({
            productId: item.id,
            quantity: item.quantity,
            price: item.price
          }))
        }
      },
      include: {
        client: true,
        user: true,
        orderDetails: {
          include: {
            product: true
          }
        }
      }
    });

    // 3. Create OrderPayment records (one per payment method)
    for (const payment of paymentBreakdown) {
      await tx.orderPayment.create({
        data: {
          orderId: order.id,
          paymentMethod: payment.method,
          amount: payment.amount
        }
      });
    }

    // 4. Deduct stock and record history
    for (const item of items) {
      const updatedProduct = await tx.product.update({
        where: { id: item.id },
        data: {
          stock: {
            decrement: item.quantity
          }
        }
      });

      await tx.stockHistory.create({
        data: {
            storeId: effectiveStoreId,
            productId: item.id,
            userId: user.id || null,
            type: 'SALE',
            previousStock: item.previousStock,
            movementAmount: -item.quantity,
            currentStock: updatedProduct.stock,
            description: `Venta POS #${order.id.slice(-6)}`
        }
      });
    }

    // Return order with payment breakdown
    return { ...order, orderPayments: paymentBreakdown };
  });
};

const getAll = async (user) => {
  // SISTEMA puede ver todas las ventas si no hay override de tienda
  const isSistema = user.role === 'SISTEMA' || user.isSistema;
  const canSeeAll = isSistema && !user.isGlobalOverride;
  const whereClause = canSeeAll ? {} : { storeId: user.storeId };
  return await prisma.order.findMany({
    where: whereClause,
    orderBy: { createdAt: 'desc' },
    include: {
      client: true,
      user: true,
      orderDetails: {
        include: {
          product: true
        }
      },
      orderPayments: true
    }
  });
};

const getById = async (id, user) => {
  const whereClause = user.storeId ? { id: { endsWith: id }, storeId: user.storeId } : { id: { endsWith: id } };
  
  const order = await prisma.order.findFirst({
    where: whereClause,
    include: {
      client: true,
      user: true,
      orderDetails: {
        include: {
          product: true
        }
      },
      orderPayments: true
    }
  });

  if (!order) {
    throw new Error(`Venta con ID ${id} no encontrada`);
  }

  return order;
};

module.exports = { create, getAll, getById };
