/**
 * RBAC Service - Servicio de verificación de permisos
 * Implementa la lógica de autorización basada en roles
 */
const prisma = require('../db/database.prisma');
const permissionsCache = require('./permissionsCache');

// Feature flag para modo shadow (solo loguea, no bloquea)
const RBAC_ENABLED = process.env.RBAC_ENABLED === 'true';
const RBAC_SHADOW = process.env.RBAC_SHADOW === 'true';

/**
 * Verifica si el usuario tiene un permiso específico
 * @param {Object} params - Parámetros de verificación
 * @param {string} params.userId - ID del usuario
 * @param {string} params.storeId - ID de la tienda (del header x-store-id)
 * @param {string} params.permission - Permiso requerido (ej: "product.create")
 * @returns {Promise<boolean>} true si tiene permiso, false si no
 */
async function checkPermission({ userId, storeId, permission, simulatedRole }) {
  // Fail-safe: if RBAC not explicitly enabled, deny by default
  if (!RBAC_ENABLED && !RBAC_SHADOW) {
    console.warn(`[RBAC] Access denied: RBAC not enabled (RBAC_ENABLED=${process.env.RBAC_ENABLED}, RBAC_SHADOW=${process.env.RBAC_SHADOW}). User: ${userId}, Permission: ${permission}, Store: ${storeId}`);
    return false;
  }

  // Shadow mode: log but allow
  if (RBAC_SHADOW && !RBAC_ENABLED) {
    console.log(`[RBAC-SHADOW] Would check: ${permission} for user ${userId} in store ${storeId} (SHADOW MODE)`);
    return true;
  }

  // Enforced mode (RBAC_ENABLED === true)
  try {
    // 1. Obtener usuario con su rol y permisos
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        rbacRole: {
          include: {
            permissions: {
              include: { permission: true }
            }
          }
        }
      }
    });

    // Verificar que el usuario existe y está activo
    if (!user || !user.isActive) {
      console.warn(`[RBAC] User ${userId} not found or inactive`);
      return false;
    }

    // Si no tiene rol asignado, denegar
    if (!user.rbacRole) {
      console.warn(`[RBAC] User ${userId} has no role assigned`);
      return false;
    }

    // 2. SISTEMA: acceso total — salvo que esté en modo simulación
    if (user.rbacRole.name === 'SISTEMA') {
      // Modo simulación: restringir permisos según el rol simulado
      if (simulatedRole) {
        // Excepción: Permitir siempre la lectura de tiendas para el selector del Sidebar
        if (permission === 'store.read') return true;

        const simRole = await prisma.role.findFirst({
          where: { name: simulatedRole },
          include: { permissions: { include: { permission: true } } }
        });
        if (!simRole) {
          console.warn(`[RBAC-SIM] Rol simulado "${simulatedRole}" no encontrado en DB`);
          return false;
        }
        const simPermissions = simRole.permissions.map(p => p.permission.name);
        const hasPermission = simPermissions.includes(permission);
        if (!hasPermission) {
          console.warn(`[RBAC-SIM] SISTEMA simulando ${simulatedRole}: DENIED "${permission}"`);
        }
        return hasPermission;
      }

      if (storeId) {
        // Si especificó storeId, verificar que exista
        const storeExists = await prisma.store.findUnique({ where: { id: storeId } });
        if (!storeExists) {
          console.warn(`[RBAC] SISTEMA user ${userId} tried to access non-existent store ${storeId}`);
          return false;
        }
      }
      // SISTEMA siempre tiene acceso, con o sin storeId
      return true;
    }

    // 3. Validar store context para otros roles
    // ADMINISTRADOR, ENCARGADO, VENDEDOR solo pueden operar en su tienda
    if (storeId && user.storeId !== storeId) {
      console.warn(`[RBAC] User ${userId} (store: ${user.storeId}) tried to access store ${storeId}`);
      return false;
    }

    // Si no tiene tienda asignada (excepto SISTEMA), denegar
    if (!user.storeId && user.rbacRole.name !== 'SISTEMA') {
      console.warn(`[RBAC] User ${userId} has no store assigned`);
      return false;
    }

    // 4. Verificar permiso específico
    const userPermissions = user.rbacRole.permissions.map(p => p.permission.name);
    const hasPermission = userPermissions.includes(permission);

    if (!hasPermission) {
      console.warn(`[RBAC] DENIED: User ${userId} lacks "${permission}"`);
    }

    return hasPermission;

  } catch (error) {
    console.error(`[RBAC] Error checking permission:`, error.message);
    // En caso de error, denegar por seguridad
    return false;
  }
}

/**
 * Obtiene todos los permisos del usuario (para UI)
 * @param {string} userId - ID del usuario
 * @returns {Promise<string[]>} Array de nombres de permisos
 */
async function getUserPermissions(userId) {
  const cacheKey = `user_permissions_${userId}`;

  // Verificar cache primero
  const cached = permissionsCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      rbacRole: {
        include: {
          permissions: {
            include: { permission: true }
          }
        }
      }
    }
  });

  if (!user || !user.rbacRole) {
    return [];
  }

  const permissions = user.rbacRole.permissions.map(p => p.permission.name);

  // Cache por 5 minutos
  permissionsCache.set(cacheKey, permissions, 5 * 60 * 1000);

  return permissions;
}

/**
 * Obtiene el rol del usuario
 * @param {string} userId - ID del usuario
 * @returns {Promise<string|null>} Nombre del rol
 */
async function getUserRole(userId) {
  const cacheKey = `user_role_${userId}`;

  const cached = permissionsCache.get(cacheKey);
  if (cached) return cached;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { rbacRole: true }
  });

  if (!user || !user.rbacRole) {
    return null;
  }

  permissionsCache.set(cacheKey, user.rbacRole.name);
  return user.rbacRole.name;
}

/**
 * Asigna un rol a un usuario (con validación de permisos del asignador)
 * @param {Object} params - Parámetros
 * @param {string} params.targetUserId - ID del usuario objetivo
 * @param {string} params.newRoleId - ID del nuevo rol
 * @param {string} params.assignedByUserId - ID del usuario que asigna
 * @param {string} params.reason - Razón del cambio (opcional)
 * @returns {Promise<Object>} Usuario actualizado
 */
async function assignRole({ targetUserId, newRoleId, assignedByUserId, reason }) {
  // Verificar que el asignador tiene permiso
  const assignerHasPermission = await checkPermission({
    userId: assignedByUserId,
    storeId: null,
    permission: 'user.manage-roles'
  });

  if (!assignerHasPermission) {
    throw new Error('No tienes permiso para asignar roles');
  }

  // Obtener usuario objetivo para auditoría
  const targetUser = await prisma.user.findUnique({
    where: { id: targetUserId },
    include: { rbacRole: true }
  });

  if (!targetUser) {
    throw new Error('Usuario no encontrado');
  }

  // Verificar que el nuevo rol existe
  const newRole = await prisma.role.findUnique({
    where: { id: newRoleId }
  });

  if (!newRole) {
    throw new Error('Rol no encontrado');
  }

  // Actualizar rol del usuario
  const updatedUser = await prisma.user.update({
    where: { id: targetUserId },
    data: { roleId: newRoleId }
  });

  // Registrar en auditoría
  await prisma.roleAudit.create({
    data: {
      userId: targetUserId,
      previousRoleId: targetUser.rbacRole?.id || null,
      newRoleId: newRoleId,
      changedBy: assignedByUserId,
      reason: reason || 'Asignación manual de rol',
    }
  });

  // Invalidar cache del usuario
  permissionsCache.invalidateUser(targetUserId);

  return updatedUser;
}

/**
 * Obtiene el estado del RBAC
 */
function isRbacEnabled() {
  return RBAC_ENABLED;
}

module.exports = {
  checkPermission,
  getUserPermissions,
  getUserRole,
  assignRole,
  isRbacEnabled
};
