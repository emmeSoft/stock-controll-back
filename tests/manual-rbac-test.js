/**
 * Test Manual de RBAC - Verificación de permisos
 * 
 * Este script prueba los diferentes escenarios de permisos.
 * Ejecutar con: node tests/manual-rbac-test.js
 * 
 * IMPORTANTE: RBAC_ENABLED debe estar en 'false' inicialmente
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function runTests() {
  console.log('🧪 Iniciando tests manuales de RBAC...\n');
  console.log('='.repeat(50));

  // Obtener usuarios de prueba
  const users = await prisma.user.findMany({
    include: { rbacRole: true }
  });

  const sistema = users.find(u => u.rbacRole?.name === 'SISTEMA');
  const admins = users.filter(u => u.rbacRole?.name === 'ADMINISTRADOR');
  const encargado = users.find(u => u.rbacRole?.name === 'ENCARGADO');
  const vendedor = users.find(u => u.rbacRole?.name === 'VENDEDOR');

  console.log('\n📋 Usuarios encontrados:');
  console.log(`  SISTEMA: ${sistema?.email || 'NO ENCONTRADO'}`);
  console.log(`  ADMINISTRADOR: ${admins[0]?.email || 'NO ENCONTRADO'}`);
  console.log(`  ENCARGADO: ${encargado?.email || 'NO ENCONTRADO'}`);
  console.log(`  VENDEDOR: ${vendedor?.email || 'NO ENCONTRADO'}`);

  console.log('\n' + '='.repeat(50));
  console.log('\n📝 RESUMEN DE TESTS MANUALES A REALIZAR:\n');

  console.log('1️⃣  TEST: Vendedor NO puede crear producto');
  console.log('   - Login como VENDEDOR');
  console.log('   - POST /api/products (con token)');
  console.log('   - Esperado: 403 Forbidden (cuando RBAC_ENABLED=true)');

  console.log('\n2️⃣  TEST: Administrador PUEDE crear producto');
  console.log('   - Login como ADMINISTRADOR');
  console.log('   - POST /api/products (con token)');
  console.log('   - Esperado: 201 Created');

  console.log('\n3️⃣  TEST: Vendedor PUEDE crear venta');
  console.log('   - Login como VENDEDOR');
  console.log('   - POST /api/sales (con token)');
  console.log('   - Esperado: 201 Created');

  console.log('\n4️⃣  TEST: Vendedor NO puede crear categoría');
  console.log('   - Login como VENDEDOR');
  console.log('   - POST /api/categories (con token)');
  console.log('   - Esperado: 403 Forbidden (cuando RBAC_ENABLED=true)');

  console.log('\n5️⃣  TEST: Sistema accede a cualquier tienda');
  console.log('   - Login como SISTEMA');
  console.log('   - Header x-store-id: cualquier store');
  console.log('   - GET /api/products');
  console.log('   - Esperado: 200 OK');

  console.log('\n6️⃣  TEST: Vendedor ve solo sus ventas');
  console.log('   - Login como VENDEDOR');
  console.log('   - GET /api/sales');
  console.log('   - Verificar que solo retorna ventas propias');

  console.log('\n' + '='.repeat(50));
  console.log('\n⚠️  PARA HABILITAR RBAC REAL, establecer:');
  console.log('   RBAC_ENABLED=true en .env o variable de entorno');

  console.log('\n✅ Tests definidos. El sistema está listo para probar.');

  await prisma.$disconnect();
}

runTests().catch(console.error);
