const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkStoreConfig() {
  try {
    const stores = await prisma.store.findMany();
    console.log('--- Configuración de Tiendas ---');
    stores.forEach(s => {
      console.log(`ID: ${s.id} | Nombre: ${s.name} | maxDiscountPct: ${s.maxDiscountPct}`);
    });

    const activeRules = await prisma.discountRule.findMany({
      where: { isActive: true },
      select: { id: true, name: true, percentage: true, engineVersion: true, storeId: true }
    });
    console.log('\n--- Reglas Activas ---');
    activeRules.forEach(r => {
      console.log(`Tienda: ${r.storeId} | ID: ${r.id} | Nombre: ${r.name} | %: ${r.percentage} | Engine: ${r.engineVersion}`);
    });

  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
}

checkStoreConfig();
