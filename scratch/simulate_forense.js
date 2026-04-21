const { PrismaClient } = require('@prisma/client');
const discountService = require('../services/discountService');

async function simulate() {
  const prisma = new PrismaClient();
  try {
    const storeId = 'cmn3tbfqv0000x3hsxej96x6n'; // Supermercado Central
    
    // Buscamos un producto válido de la tienda dinámicamente
    const product = await prisma.product.findFirst({ where: { storeId } });
    if (!product) throw new Error('No hay productos en esta tienda para simular.');

    // Simulamos un carrito con ese producto
    const items = [
      { id: product.id, quantity: 1 }
    ];

    console.log('--- SIMULACIÓN DE PREVIEW ---');
    console.log('Caso: 50% Auto + 10% Efectivo (Preferred)');
    
    // IDs de las reglas que vimos antes:
    const rule50Id = 'cmo6eevww0001x3q05ud2at6d'; // 50%
    const rule10Id = 'cmo6efeup0002x3q0y25wmvn6'; // 10% efectivo

    const result = await discountService.preview(storeId, {
      items,
      paymentMethods: ['Efectivo'],
      preferredRuleIds: [rule50Id, rule10Id], // El usuario marca ambas
      excludedRuleIds: []
    });

    console.log('\n--- RESULTADO FINAL ---');
    console.log(`Subtotal: $${result.originalTotal}`);
    console.log(`Descuento Total: $${result.discountTotal}`);
    console.log(`Aplicados: ${result.appliedDiscounts.map(d => d.name).join(', ')}`);
    console.log(`Intercambiables: ${result.interchangeableDiscounts.map(d => d.name).join(', ')}`);

  } catch (err) {
    console.error('Error en simulación:', err);
  } finally {
    await prisma.$disconnect();
  }
}

simulate();
