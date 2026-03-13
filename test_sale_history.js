const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const salesServices = require('./services/salesServices');

async function testSale() {
  try {
    // 1. Get a product and a store
    const product = await prisma.product.findFirst();
    if (!product) {
      console.log('No products found');
      return;
    }
    console.log(`Testing with product: ${product.name} (Store: ${product.storeId})`);

    // 2. Get the store
    const store = await prisma.store.findUnique({ where: { id: product.storeId } });
    if (!store) {
      console.log('Store not found');
      return;
    }

    // 3. We need a user assigned to this store or a superadmin
    let user = await prisma.user.findFirst({ where: { storeId: store.id } });
    if (!user) {
        user = await prisma.user.findFirst({ where: { role: 'SUPERADMIN' } });
    }
    
    if (!user) {
        console.log('No users found');
        return;
    }
    console.log(`Using user: ${user.email} (Role: ${user.role})`);

    // 4. We need an open register
    let register = await prisma.cashRegister.findFirst({ where: { storeId: store.id, status: 'OPEN' } });
    if (!register) {
        console.log('Opening a register...');
        register = await prisma.cashRegister.create({
            data: {
                storeId: store.id,
                openedByUserId: user.id,
                openingAmount: 1000,
                status: 'OPEN'
            }
        });
    }

    // 5. Create a sale
    const saleData = {
      items: [
        { id: product.id, quantity: 1, price: product.price }
      ],
      amount: product.price,
      paymentMethod: 'Efectivo'
    };

    console.log('Creating sale...');
    const result = await salesServices.create(saleData, { ...user, storeId: store.id });
    console.log('Sale created successfully:', result.id);

    // 6. Check history
    const history = await prisma.stockHistory.findFirst({
      where: { productId: product.id },
      orderBy: { createdAt: 'desc' },
      include: { product: true }
    });

    console.log('Latest history entry for this product:');
    console.log(JSON.stringify(history, null, 2));

  } catch (error) {
    console.error('Error in test:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testSale();
