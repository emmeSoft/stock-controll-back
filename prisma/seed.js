const { PrismaClient } = require('@prisma/client');
const { fakerES: faker } = require('@faker-js/faker');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

async function main() {
  console.log('Iniciando carga de datos de prueba para MÚLTIPLES TIENDAS...');

  // 1. Definimos las tiendas que queremos crear y sus administradores
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

    // Contraseña común para todos los usuarios de prueba
  const hashedPassword = await bcrypt.hash('123456', 10);

  // 2. Usamos un bucle "for...of" para recorrer nuestra lista de configuraciones.
  // IMPORTANTE: Un bucle "for...of" es ideal en programación asíncrona (cuando usamos "await"),
  // porque espera a que termine de procesar una tienda antes de pasar a la siguiente.
  for (const config of storesConfig) {
    console.log(`\n--- Configurando Tienda: ${config.storeName} ---`);

    // -> Crear la tienda
    const store = await prisma.store.create({
      data: {
        name: config.storeName,
        address: faker.location.streetAddress(),
        phone: faker.phone.number({ style: 'national' }),
        isActive: true,
      },
    });
    console.log(`✅ Tienda creada con ID: ${store.id}`);

    // -> Crear un usuario ADMIN para esta tienda
    await prisma.user.create({
      data: {
        storeId: store.id,
        email: config.adminEmail,
        password: hashedPassword,
        tempPassword: "0000",
        mustChangePassword: true,
        firstName: faker.person.firstName(),
        lastName: faker.person.lastName(),
        phoneNumber: faker.phone.number({ style: 'national' }),
        address: faker.location.streetAddress(),
        city: faker.location.city(),
        role: 'ADMIN',
      },
    });
    console.log(`✅ Admin creado: ${config.adminEmail} (Clave: 123456 - Cambio forzado)`);

    // -> Crear un usuario normal (USUARIO) para esta tienda
    await prisma.user.create({
      data: {
        storeId: store.id,
        email: config.userEmail,
        password: hashedPassword,
        tempPassword: "0000",
        mustChangePassword: true,
        firstName: faker.person.firstName(),
        lastName: faker.person.lastName(),
        phoneNumber: faker.phone.number({ style: 'national' }),
        address: faker.location.streetAddress(),
        city: faker.location.city(),
        role: 'USUARIO',
      },
    });
    console.log(`✅ Cajero/Usuario creado: ${config.userEmail} (Clave: 123456 - Cambio forzado)`);

    // -> Crear 3 Categorías para esta tienda
    const categoriesToCreate = Array.from({ length: 3 }).map(() => ({
      storeId: store.id,
      name: faker.commerce.department(),
      description: faker.commerce.productDescription(),
    }));
    await prisma.categories.createMany({ data: categoriesToCreate });

    // Obtenemos las categorías de la BD para sacar sus IDs y asignarlas a los productos
    const storeCategories = await prisma.categories.findMany({ where: { storeId: store.id } });

    // -> Crear 10 Productos asignados EXCLUSIVAMENTE a esta tienda y a sus categorías
    const productsToCreate = Array.from({ length: 10 }).map(() => ({
      storeId: store.id,
      name: faker.commerce.productName(),
      description: faker.commerce.productDescription(),
      price: parseFloat(faker.commerce.price({ min: 100, max: 2000 })),
      stock: faker.number.int({ min: 10, max: 100 }),
      categoryId: faker.helpers.arrayElement(storeCategories).id,
      isActive: true,
    }));
    await prisma.product.createMany({ data: productsToCreate });
    console.log(`✅ 3 Categorías y 10 Productos creados para ${config.storeName}`);

    // -> Crear 5 Clientes exclusivos de esta tienda
    const clientsToCreate = Array.from({ length: 5 }).map(() => {
      const firstName = faker.person.firstName();
      const lastName = faker.person.lastName();
      return {
        storeId: store.id,
        email: faker.internet.email({ firstName, lastName }),
        firstName,
        lastName,
        fullName: `${firstName} ${lastName}`,
        dni: faker.string.numeric(8),
        phoneNumber: faker.phone.number({ style: 'national' }),
        address: faker.location.streetAddress(),
        city: faker.location.city(),
      };
    });
    await prisma.client.createMany({ data: clientsToCreate });
    console.log(`✅ 5 Clientes creados para ${config.storeName}`);
  }

  console.log('\n======================================================');
  console.log('¡Datos de prueba MASIVOS generados correctamente!');
  console.log('Ahora tienes TIENDAS completamente separadas con sus');
  console.log('propios productos, clientes, administradores y empleados.');
  console.log('======================================================\n');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
