const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkSale() {
  const saleId = 'cmo7ukn4w0003x3hs4ueuinf0';
  const sale = await prisma.order.findUnique({
    where: { id: saleId },
    include: {
      cashRegister: true,
      orderDetails: true
    }
  });

  console.log('--- DATA FOR SALE ' + saleId + ' ---');
  console.log(JSON.stringify(sale, null, 2));
  await prisma.$disconnect();
}

checkSale();
