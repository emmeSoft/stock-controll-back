/**
 * Seed RBAC - Roles y Permisos
 * Ejecutar con: node prisma/seedRbac.js
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const PERMISSIONS = [
  // USUARIOS
  { name: 'user.create', category: 'USUARIOS', description: 'Crear usuarios' },
  { name: 'user.read', category: 'USUARIOS', description: 'Ver usuarios' },
  { name: 'user.update', category: 'USUARIOS', description: 'Editar usuarios' },
  { name: 'user.delete', category: 'USUARIOS', description: 'Eliminar usuarios' },
  { name: 'user.manage-roles', category: 'USUARIOS', description: 'Asignar roles' },

  // TIENDAS
  { name: 'store.create', category: 'TIENDAS', description: 'Crear tiendas' },
  { name: 'store.read', category: 'TIENDAS', description: 'Ver tiendas' },
  { name: 'store.update', category: 'TIENDAS', description: 'Editar tiendas' },
  { name: 'store.delete', category: 'TIENDAS', description: 'Eliminar tiendas' },

  // PRODUCTOS
  { name: 'product.create', category: 'PRODUCTOS', description: 'Crear productos' },
  { name: 'product.read', category: 'PRODUCTOS', description: 'Ver productos' },
  { name: 'product.update', category: 'PRODUCTOS', description: 'Editar productos' },
  { name: 'product.delete', category: 'PRODUCTOS', description: 'Eliminar productos' },
  { name: 'product.price-change', category: 'PRODUCTOS', description: 'Cambiar precios' },

  // CATEGORÍAS
  { name: 'category.create', category: 'CATEGORÍAS', description: 'Crear categorías' },
  { name: 'category.read', category: 'CATEGORÍAS', description: 'Ver categorías' },
  { name: 'category.update', category: 'CATEGORÍAS', description: 'Editar categorías' },
  { name: 'category.delete', category: 'CATEGORÍAS', description: 'Eliminar categorías' },

  // INVENTARIO
  { name: 'inventory.read', category: 'INVENTARIO', description: 'Ver inventario' },
  { name: 'inventory.adjust', category: 'INVENTARIO', description: 'Ajustar stock' },
  { name: 'inventory.transfer', category: 'INVENTARIO', description: 'Transferir stock' },
  { name: 'inventory.low-stock-alert', category: 'INVENTARIO', description: 'Ver alertas stock' },

  // VENTAS
  { name: 'sale.create', category: 'VENTAS', description: 'Crear ventas' },
  { name: 'sale.read', category: 'VENTAS', description: 'Ver ventas' },
  { name: 'sale.cancel', category: 'VENTAS', description: 'Cancelar ventas' },
  { name: 'sale.refund', category: 'VENTAS', description: 'Reembolsar ventas' },
  { name: 'sale.discount', category: 'VENTAS', description: 'Aplicar descuentos' },

  // CLIENTES
  { name: 'client.create', category: 'CLIENTES', description: 'Crear clientes' },
  { name: 'client.read', category: 'CLIENTES', description: 'Ver clientes' },
  { name: 'client.update', category: 'CLIENTES', description: 'Editar clientes' },
  { name: 'client.delete', category: 'CLIENTES', description: 'Eliminar clientes' },

  // PROVEEDORES
  { name: 'supplier.create', category: 'PROVEEDORES', description: 'Crear proveedores' },
  { name: 'supplier.read', category: 'PROVEEDORES', description: 'Ver proveedores' },
  { name: 'supplier.update', category: 'PROVEEDORES', description: 'Editar proveedores' },

  // MOVIMIENTOS
  { name: 'movimiento.create', category: 'CAJA', description: 'Crear movimientos de caja' },
  { name: 'movimiento.read', category: 'CAJA', description: 'Ver movimientos de caja' },

  // REPORTES
  { name: 'report.sales', category: 'REPORTES', description: 'Reporte de ventas' },
  { name: 'report.inventory', category: 'REPORTES', description: 'Reporte de inventario' },
  { name: 'report.financial', category: 'REPORTES', description: 'Reporte financiero' },
  { name: 'report.audit', category: 'REPORTES', description: 'Reporte de auditoría' },
  { name: 'seller.performance.read', category: 'REPORTES', description: 'Ver rendimiento de vendedores' },

  // CAJA
  { name: 'caja.open', category: 'CAJA', description: 'Abrir caja' },
  { name: 'caja.close', category: 'CAJA', description: 'Cerrar caja' },
  { name: 'caja.read', category: 'CAJA', description: 'Ver caja' },
  { name: 'caja.reconcile', category: 'CAJA', description: 'Conciliar caja' },

  // CONFIGURACIÓN
  { name: 'config.read', category: 'CONFIG', description: 'Ver configuración' },
  { name: 'config.update', category: 'CONFIG', description: 'Editar configuración' },

  // AUDITORÍA
  { name: 'audit.read', category: 'AUDITORÍA', description: 'Ver logs de auditoría' },
  { name: 'audit.export', category: 'AUDITORÍA', description: 'Exportar auditoría' },

  // INTEGRACIONES
  { name: 'integration.read', category: 'INTEGRACIONES', description: 'Ver integraciones' },
  { name: 'integration.update', category: 'INTEGRACIONES', description: 'Editar integraciones' },

  // DESCUENTOS
  { name: 'discount.create', category: 'DESCUENTOS', description: 'Crear reglas de descuento' },
  { name: 'discount.read',   category: 'DESCUENTOS', description: 'Ver reglas de descuento' },
  { name: 'discount.update', category: 'DESCUENTOS', description: 'Editar reglas de descuento' },
  { name: 'discount.delete', category: 'DESCUENTOS', description: 'Desactivar reglas de descuento (soft delete)' },
];

const ROLES = [
  { name: 'SISTEMA', description: 'Acceso total al sistema', isSystem: true },
  { name: 'ADMINISTRADOR', description: 'Administrador de tienda', isSystem: false },
  { name: 'ENCARGADO', description: 'Encargado de tienda', isSystem: false },
  { name: 'VENDEDOR', description: 'Vendedor', isSystem: false },
];

// Mapa de permisos por rol
const ROLE_PERMISSIONS = {
  SISTEMA: PERMISSIONS.map(p => p.name), // Todos los permisos
  ADMINISTRADOR: [
    'user.create', 'user.read', 'user.update', 'user.manage-roles',
    'store.read', 'store.update',
    'product.create', 'product.read', 'product.update', 'product.delete', 'product.price-change',
    'category.create', 'category.read', 'category.update', 'category.delete',
    'inventory.read', 'inventory.adjust', 'inventory.transfer', 'inventory.low-stock-alert',
    'sale.create', 'sale.read', 'sale.cancel', 'sale.refund', 'sale.discount',
    'client.create', 'client.read', 'client.update', 'client.delete',
    'supplier.create', 'supplier.read', 'supplier.update',
    'movimiento.create', 'movimiento.read',
    'report.sales', 'report.inventory', 'report.financial', 'report.audit', 'seller.performance.read',
    'caja.open', 'caja.close', 'caja.read', 'caja.reconcile',
    'config.read', 'config.update',
    'audit.read', 'audit.export',
    'integration.read', 'integration.update',
    'discount.create', 'discount.read', 'discount.update', 'discount.delete',
  ],
  ENCARGADO: [
    'user.read',
    'store.read',
    'product.create', 'product.read', 'product.update',
    'category.create', 'category.read', 'category.update',
    'inventory.read', 'inventory.adjust', 'inventory.transfer', 'inventory.low-stock-alert',
    'sale.create', 'sale.read', 'sale.cancel', 'sale.refund', 'sale.discount',
    'client.create', 'client.read', 'client.update',
    'supplier.create', 'supplier.read', 'supplier.update',
    'movimiento.create', 'movimiento.read',
    'report.sales', 'report.inventory',
    'caja.open', 'caja.close', 'caja.read',
    'config.read',
    'integration.read',
    'discount.create', 'discount.read', 'discount.update', 'discount.delete',
  ],
  VENDEDOR: [
    'product.read',
    'category.read',
    'inventory.read', 'inventory.low-stock-alert',
    'sale.create', 'sale.read',
    'client.create', 'client.read',
    'supplier.read',
    'movimiento.create', 'movimiento.read',
    'report.sales',
    'caja.open', 'caja.close', 'caja.read',
    'discount.read',
  ],
};

async function seedRBAC() {
  console.log('🌱 Seeding RBAC...');

  try {
    // 1. Crear permisos
    for (const perm of PERMISSIONS) {
      await prisma.permission.upsert({
        where: { name: perm.name },
        update: {},
        create: perm,
      });
    }
    console.log(`✅ Created ${PERMISSIONS.length} permissions`);

    // 2. Crear roles
    const createdRoles = {};
    for (const role of ROLES) {
      const created = await prisma.role.upsert({
        where: { name: role.name },
        update: {},
        create: role,
      });
      createdRoles[role.name] = created.id;
      console.log(`✅ Created role: ${role.name}`);
    }

    // 3. Asignar permisos a roles
    for (const [roleName, permissions] of Object.entries(ROLE_PERMISSIONS)) {
      const roleId = createdRoles[roleName];

      for (const permName of permissions) {
        const perm = await prisma.permission.findUnique({ where: { name: permName } });

        if (perm) {
          await prisma.permissionRole.upsert({
            where: {
              roleId_permissionId: {
                roleId,
                permissionId: perm.id,
              }
            },
            update: {},
            create: {
              roleId,
              permissionId: perm.id,
            },
          });
        }
      }
      console.log(`✅ Assigned ${permissions.length} permissions to ${roleName}`);
    }

    // 4. Migrar usuarios existentes
    console.log('\n📦 Migrando usuarios existentes...');
    
    const users = await prisma.user.findMany();
    const roleMap = {
      'SUPERADMIN': createdRoles['SISTEMA'],
      'ADMIN': createdRoles['ADMINISTRADOR'],
      'USUARIO': createdRoles['VENDEDOR'],
    };

    for (const user of users) {
      const legacyRole = user.roleLegacy || 'USUARIO';
      const newRoleId = roleMap[legacyRole] || createdRoles['VENDEDOR'];

      await prisma.user.update({
        where: { id: user.id },
        data: { roleId: newRoleId },
      });

      // Registrar en auditoría
      await prisma.roleAudit.create({
        data: {
          userId: user.id,
          previousRoleId: null,
          newRoleId: newRoleId,
          changedBy: 'SYSTEM_MIGRATION',
          reason: 'Migración inicial de roles legacy',
        }
      });

      console.log(`  ✅ Migrated user ${user.email}: ${legacyRole} → ${newRoleId ? Object.entries(roleMap).find(([k,v]) => v === newRoleId)?.[0] : 'VENDEDOR'}`);
    }

    // 5. Establecer maxi@maxi.com como SISTEMA
    console.log('\n👤 Estableciendo maxi@maxi.com como SISTEMA...');
    const maxiUser = await prisma.user.findUnique({ where: { email: 'maxi@maxi.com' } });
    if (maxiUser) {
      const previousRoleId = maxiUser.roleId;
      const sistemaRoleId = createdRoles['SISTEMA'];
      
      await prisma.user.update({
        where: { id: maxiUser.id },
        data: { roleId: sistemaRoleId },
      });

      // Registrar cambio en auditoría
      await prisma.roleAudit.create({
        data: {
          userId: maxiUser.id,
          previousRoleId: previousRoleId,
          newRoleId: sistemaRoleId,
          changedBy: 'SYSTEM_SETUP',
          reason: 'Usuario root del sistema',
        }
      });

      console.log(`  ✅ maxi@maxi.com ahora es SISTEMA`);
    }

    console.log('\n🎉 RBAC seeding complete!');

    // Mostrar resumen
    console.log('\n📊 Resumen:');
    const roleCounts = await prisma.role.findMany({
      include: { users: true }
    });
    for (const r of roleCounts) {
      console.log(`  - ${r.name}: ${r.users.length} usuarios`);
    }

  } catch (error) {
    console.error('❌ Error seeding RBAC:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Ejecutar
seedRBAC()
  .then(() => {
    console.log('\n✅ Seed completed successfully');
    process.exit(0);
  })
  .catch((e) => {
    console.error('\n❌ Seed failed:', e);
    process.exit(1);
  });
