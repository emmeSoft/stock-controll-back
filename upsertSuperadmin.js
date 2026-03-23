const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const superadminData = require('./superadmin.json')[0];

async function main() {
  if (!superadminData) {
    console.log('No superadmin data to restore.');
    return;
  }
  await prisma.user.upsert({
    where: { email: superadminData.email },
    update: {
      password: superadminData.password,
      role: 'SUPERADMIN',
      isActive: true,
      mustChangePassword: false,
    },
    create: {
      id: "1",
      email: superadminData.email,
      password: superadminData.password,
      firstName: superadminData.firstName,
      lastName: superadminData.lastName,
      phoneNumber: superadminData.phoneNumber,
      address: superadminData.address,
      city: superadminData.city,
      role: 'SUPERADMIN',
      isActive: true,
      mustChangePassword: false,
    }
  });
  console.log('Superadmin restoring/upserting done.');
}
main().catch(console.error).finally(() => prisma.$disconnect());
