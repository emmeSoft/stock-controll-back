const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const prisma = new PrismaClient();
async function main() {
  const users = await prisma.user.findMany({ where: { role: 'SUPERADMIN' } });
  fs.writeFileSync('superadmin.json', JSON.stringify(users, null, 2));
}
main().finally(() => prisma.$disconnect());
