const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const prisma = new PrismaClient();

async function hashPasswords() {
  console.log('Fetching all users...');
  const users = await prisma.user.findMany();

  for (const user of users) {
    if (user.password && user.password.length < 60) {
      console.log(`Hashing password for user: ${user.email}`);
      const hashedPassword = await bcrypt.hash(user.password, 10);
      
      await prisma.user.update({
        where: { id: user.id },
        data: { password: hashedPassword }
      });
      console.log(`User ${user.email} updated successfully.`);
    } else {
      console.log(`User ${user.email} password already looks hashed (length ${user.password?.length}). Skipping.`);
    }
  }

  console.log('Migration completed successfully.');
  await prisma.$disconnect();
}

hashPasswords().catch(e => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
