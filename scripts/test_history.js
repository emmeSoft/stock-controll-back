const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    const history = await prisma.stockHistory.findMany({
      include: {
        product: true,
        user: true,
        store: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
    console.log('Success! Found records:', history.length);
  } catch (err) {
    console.error('Test script Error:', err.message);
  }
}

main().finally(() => prisma.$disconnect());
