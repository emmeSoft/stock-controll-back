const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkHistory() {
  try {
    const history = await prisma.stockHistory.findMany({
      take: 10,
      orderBy: { createdAt: 'desc' },
      include: {
        product: { select: { name: true } },
        store: { select: { name: true } }
      }
    });

    console.log('Last 10 Stock History entries:');
    console.log(JSON.stringify(history, null, 2));

    const totalCount = await prisma.stockHistory.count();
    console.log('Total Stock History entries:', totalCount);

  } catch (error) {
    console.error('Error checking history:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkHistory();
