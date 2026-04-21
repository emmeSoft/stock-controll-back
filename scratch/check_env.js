const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkUserAndStores() {
  const user = await prisma.user.findUnique({
    where: { id: '1' }
  });
  const stores = await prisma.store.findMany();

  console.log('--- USER 1 ---');
  console.log(JSON.stringify(user, null, 2));
  console.log('--- STORES ---');
  console.log(JSON.stringify(stores, null, 2));
  await prisma.$disconnect();
}

checkUserAndStores();
