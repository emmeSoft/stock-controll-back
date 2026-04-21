/**
 * RBAC Middleware - Middleware de verificación de permisos
 * Se integra con Express para verificar permisos en cada request
 */
const rbacService = require('../services/rbacService');

// Feature flags
const RBAC_ENABLED = process.env.RBAC_ENABLED === 'true';
const RBAC_SHADOW = process.env.RBAC_SHADOW === 'true';

/**
 * Middleware que verifica permisos atómicos
 * @param {string} permission - Permiso requerido (ej: "product.create")
 * @returns {Function} Middleware de Express
 */
const requirePermission = (permission) => {
  return async (req, res, next) => {
    try {
      const userId = req.user?.id;
      const storeId = req.headers['x-store-id'] || req.user?.storeId;
      

      // Verificar que el usuario está autenticado
      if (!userId) {
        console.warn(`[RBAC] Unauthorized request to ${req.method} ${req.originalUrl}`);
        return res.status(401).json({
          error: 'UNAUTHORIZED',
          message: 'Usuario no autenticado'
        });
      }

      // Fail-safe: if RBAC not explicitly enabled, deny by default
      if (!RBAC_ENABLED && !RBAC_SHADOW) {
        console.warn(`[RBAC] Access denied: RBAC not enabled (RBAC_ENABLED=${process.env.RBAC_ENABLED}, RBAC_SHADOW=${process.env.RBAC_SHADOW}). User: ${userId}, Permission: ${permission}`);
        return res.status(403).json({
          error: 'FORBIDDEN',
          message: 'RBAC no está habilitado. Acceso denegado por seguridad.'
        });
      }

      // Verificar permiso (el servicio ya maneja shadow mode)
      const hasPermission = await rbacService.checkPermission({
        userId,
        storeId,
        permission,
        simulatedRole: req.user?.simulatedRole || null,
      });

      if (!hasPermission) {
        // Log de acceso denegado para auditoría
        console.warn(`[RBAC] DENIED: User ${userId} lacks "${permission}" for store ${storeId} - ${req.method} ${req.originalUrl}`);

        return res.status(403).json({
          error: 'FORBIDDEN',
          message: `No tienes permiso para realizar esta acción`,
          required: permission
        });
      }

      next();
    } catch (error) {
      console.error(`[RBAC] Error: ${error.message}`);
      return res.status(500).json({
        error: 'INTERNAL_ERROR',
        message: 'Error en verificación de permisos'
      });
    }
  };
};

/**
 * Middleware que verifica si el usuario es de un rol específico
 * @param {string|Array<string>} roles - Rol o array de roles permitidos
 * @returns {Function} Middleware de Express
 */
const requireRole = (roles) => {
  const allowedRoles = Array.isArray(roles) ? roles : [roles];

  return async (req, res, next) => {
    try {
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({
          error: 'UNAUTHORIZED',
          message: 'Usuario no autenticado'
        });
      }

      const userRole = await rbacService.getUserRole(userId);

      if (!userRole || !allowedRoles.includes(userRole)) {
        console.warn(`[RBAC] DENIED: User ${userId} has role "${userRole}", required: ${allowedRoles.join(' or ')}`);

        return res.status(403).json({
          error: 'FORBIDDEN',
          message: `Se requiere uno de los siguientes roles: ${allowedRoles.join(', ')}`,
          required: allowedRoles,
          current: userRole
        });
      }

      next();
    } catch (error) {
      console.error(`[RBAC] Error in requireRole: ${error.message}`);
      return res.status(500).json({
        error: 'INTERNAL_ERROR',
        message: 'Error en verificación de rol'
      });
    }
  };
};

/**
 * Middleware para obtener permisos del usuario y agregarlos al request
 * Útil para que los controladores puedan verificar permisos dinámicamente
 */
const attachPermissions = () => {
  return async (req, res, next) => {
    try {
      if (req.user?.id) {
        const permissions = await rbacService.getUserPermissions(req.user.id);
        const role = await rbacService.getUserRole(req.user.id);

        req.user.permissions = permissions;
        req.user.role = role;
      }
      next();
    } catch (error) {
      console.error(`[RBAC] Error attaching permissions: ${error.message}`);
      // No bloquear request por error en permisos
      next();
    }
  };
};

module.exports = {
  requirePermission,
  requireRole,
  attachPermissions
};
