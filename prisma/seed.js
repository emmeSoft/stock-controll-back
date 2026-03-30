const { PrismaClient } = require('@prisma/client');
const { fakerES: faker } = require('@faker-js/faker');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

/* ===============================
   BARCODE ENGINE
=================================*/

// genera prefijo 3 dígitos
function generateCategoryPrefix(index) {
  return String(100 + index); // 100,101,102...
}

// genera barcode 9 dígitos
function generateBarcode(prefix, sequence) {
  return `${prefix}${String(sequence).padStart(6, '0')}`;
}

async function main() {
  console.log('🌱 Seed multi-tenant iniciado');

  const hashedPassword = await bcrypt.hash('123456', 10);
  const roles = await prisma.role.findMany({
    where: { name: { in: ['ADMINISTRADOR', 'VENDEDOR'] } }
  });
  const roleIdsByName = Object.fromEntries(roles.map((role) => [role.name, role.id]));

  if (!roleIdsByName.ADMINISTRADOR || !roleIdsByName.VENDEDOR) {
    throw new Error('Faltan roles RBAC base. Ejecutá primero el seed de RBAC para crear ADMINISTRADOR y VENDEDOR.');
  }

  const storesConfig = [
    {
      storeName: 'Supermercado Central',
      adminEmail: 'admin1@central.com',
      userEmail: 'cajero1@central.com'
    },
    {
      storeName: 'Ferretería El Tornillo',
      adminEmail: 'admin2@ferreteria.com',
      userEmail: 'vendedor2@ferreteria.com'
    },
    {
      storeName: 'Aspiradoras Hoover',
      adminEmail: 'admin3@hoover.com',
      userEmail: 'vendedor3@hoover.com'
    }
  ];

  for (const config of storesConfig) {

    await prisma.$transaction(async (tx) => {

      console.log(`\n🏪 ${config.storeName}`);

      /* ========= STORE ========= */

      const store = await tx.store.create({
        data: {
          name: config.storeName,
          address: faker.location.streetAddress(),
          phone: faker.phone.number(),
        },
      });

      /* ========= USERS ========= */

      const createUser = (email, roleName) =>
        tx.user.create({
          data: {
            storeId: store.id,
            email,
            password: hashedPassword,
            mustChangePassword: true,
            firstName: faker.person.firstName(),
            lastName: faker.person.lastName(),
            phoneNumber: faker.phone.number(),
            address: faker.location.streetAddress(),
            city: faker.location.city(),
            roleId: roleIdsByName[roleName],
          },
        });

      await createUser(config.adminEmail, 'ADMINISTRADOR');
      await createUser(config.userEmail, 'VENDEDOR');

      /* ========= CATEGORIES ========= */

      const categories = [];

      for (let i = 0; i < 3; i++) {
        const category = await tx.categories.create({
          data: {
            storeId: store.id,
            name: faker.commerce.department(),
            description: faker.commerce.productDescription(),
            barcodePrefix: generateCategoryPrefix(i),
          },
        });

        categories.push(category);
      }

      /* ========= PRODUCTS ========= */

      let globalSequence = 1;

      const products = [];

      for (const category of categories) {
        for (let i = 0; i < 3; i++) {

          const barcode = generateBarcode(
            category.barcodePrefix,
            globalSequence++
          );

          products.push({
            storeId: store.id,
            name: faker.commerce.productName(),
            description: faker.commerce.productDescription(),
            price: Number(faker.commerce.price({ min: 100, max: 2000 })),
            stock: faker.number.int({ min: 10, max: 100 }),
            categoryId: category.id,
            barcode,
            isActive: true,
          });
        }
      }

      await tx.product.createMany({ data: products });

      /* ========= CLIENTS ========= */

      const clients = Array.from({ length: 5 }).map(() => {
        const firstName = faker.person.firstName();
        const lastName = faker.person.lastName();

        return {
          storeId: store.id,
          email: faker.internet.email({ firstName, lastName }),
          firstName,
          lastName,
          fullName: `${firstName} ${lastName}`,
          dni: faker.string.numeric(8),
          phoneNumber: faker.phone.number(),
          address: faker.location.streetAddress(),
          city: faker.location.city(),
        };
      });

      await tx.client.createMany({ data: clients });

      console.log('✅ Store completa creada');
    });
  }

  console.log('\n✅ SEED FINALIZADO CORRECTAMENTE');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
