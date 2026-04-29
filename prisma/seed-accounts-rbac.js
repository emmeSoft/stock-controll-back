const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function seedPermissions() {
  const permissions = [
    { name: 'account.view', category: 'CUENTAS CORRIENTES', description: 'Ver listado y saldo de cuentas corrientes' },
    { name: 'account.detail', category: 'CUENTAS CORRIENTES', description: 'Ver detalle de movimientos de cuenta corriente' },
    { name: 'account.open', category: 'CUENTAS CORRIENTES', description: 'Abrir cuenta corriente a un cliente' },
    { name: 'account.close', category: 'CUENTAS CORRIENTES', description: 'Cerrar cuenta corriente (saldo 0)' },
    { name: 'account.payment', category: 'CUENTAS CORRIENTES', description: 'Registrar pagos a cuenta corriente' },
    { name: 'account.audit', category: 'CUENTAS CORRIENTES', description: 'Ver auditoría de movimientos' },
    { name: 'account.edit', category: 'CUENTAS CORRIENTES', description: 'Editar o anular movimientos manuales' },
  ];

  console.log('🚀 Iniciando seed de permisos para Cuentas Corrientes...');

  for (const p of permissions) {
    await prisma.permission.upsert({
      where: { name: p.name },
      update: { category: p.category, description: p.description },
      create: p,
    });
    console.log(`✅ Permiso: ${p.name}`);
  }

  // Asignación automática básica según tu matriz
  const roles = await prisma.role.findMany();
  const perms = await prisma.permission.findMany({ where: { category: 'CUENTAS CORRIENTES' } });

  const roleMap = {
    'SISTEMA': ['account.view', 'account.detail', 'account.open', 'account.close', 'account.payment', 'account.audit', 'account.edit'],
    'ADMINISTRADOR': ['account.view', 'account.detail', 'account.open', 'account.close', 'account.payment', 'account.audit'],
    'ENCARGADO': ['account.view', 'account.detail', 'account.open', 'account.payment', 'account.audit'],
    'VENDEDOR': ['account.view', 'account.detail', 'account.audit'], // Según matriz: Ver saldo en ventas, ver listado/detalle
  };

  for (const role of roles) {
    const allowed = roleMap[role.name] || [];
    for (const pName of allowed) {
      const permission = perms.find(p => p.name === pName);
      if (permission) {
        await prisma.permissionRole.upsert({
          where: {
            roleId_permissionId: {
              roleId: role.id,
              permissionId: permission.id,
            },
          },
          update: {},
          create: {
            roleId: role.id,
            permissionId: permission.id,
          },
        });
      }
    }
  }

  console.log('✨ Roles actualizados con permisos de Cuentas Corrientes.');
}

seedPermissions()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
