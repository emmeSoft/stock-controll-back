const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const cajaServices = require('./cajaServices');

const create = async (saleData, user) => {
  const { items, amount, clientId, paymentMethod } = saleData;

  // Determine effective storeId for the sale from the user's augmented context
  const effectiveStoreId = user.storeId;
  if (!effectiveStoreId) {
    throw new Error('Debe especificar una tienda para la venta.');
  }

  // VERIFICAR CAJA ABIERTA -> Regla de negocio.
  // We need to pass a mock user object with the effectiveStoreId for the check
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
        amoutPayed: amount, // Assuming full payment at POS for now
        paymentMethod: paymentMethod || "Efectivo",
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

    // 3. Deduct stock and record payments if required (simplifying as requested)
    for (const item of items) {
      await tx.product.update({
        where: { id: item.id },
        data: {
          stock: {
            decrement: item.quantity
          }
        }
      });
    }

    return order;
  });
};

const getAll = async (user) => {
  const whereClause = user.storeId ? { storeId: user.storeId } : {};
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
      }
    }
  });
};

const getById = async (id, user) => {
  const whereClause = user.storeId ? { id, storeId: user.storeId } : { id };
  
  const order = await prisma.order.findFirst({
    where: whereClause,
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

  if (!order) {
    throw new Error(`Venta con ID ${id} no encontrada`);
  }

  return order;
};

module.exports = { create, getAll, getById };
