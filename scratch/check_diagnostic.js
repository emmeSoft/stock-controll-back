const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  try {
    const storeId = 'cmn3tbfqv0000x3hsxej96x6n'; // Supermercado Central
    const store = await prisma.store.findUnique({
      where: { id: storeId },
      select: { id: true, name: true, maxDiscountPct: true }
    });
    console.log('--- STORE ---');
    console.log(JSON.stringify(store, null, 2));

    const rules = await prisma.discountRule.findMany({
      where: { storeId, isActive: true },
      select: { id: true, name: true, percentage: true, priority: true, engineVersion: true }
    });
    console.log('--- RULES ---');
    console.log(JSON.stringify(rules, null, 2));

  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
}

check();
