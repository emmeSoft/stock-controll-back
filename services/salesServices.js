const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const create = async (saleData) => {
  const { items, amount, clientId, paymentMethod } = saleData;

  // Utilize a Prisma transaction to ensure atomicity
  return await prisma.$transaction(async (tx) => {
    // 1. Verify stock for all items
    for (const item of items) {
      const product = await tx.product.findUnique({
        where: { id: item.id }
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
        orderDetails: true
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

const getAll = async () => {
  return await prisma.order.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      client: true,
      orderDetails: {
        include: {
          product: true
        }
      }
    }
  });
};

module.exports = { create, getAll };
