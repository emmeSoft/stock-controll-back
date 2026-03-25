/**
 * RBAC Middleware - Middleware de verificación de permisos
 * Se integra con Express para verificar permisos en cada request
 */
const rbacService = require('../services/rbacService');

// Feature flag global
const RBAC_ENABLED = process.env.RBAC_ENABLED === 'true';

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
      
      console.log('[RBAC-Middleware] Incoming request:', req.method, req.originalUrl);
      console.log('[RBAC-Middleware] userId:', userId);
      console.log('[RBAC-Middleware] storeId from header:', req.headers['x-store-id']);
      console.log('[RBAC-Middleware] storeId from user:', req.user?.storeId);
      console.log('[RBAC-Middleware] final storeId:', storeId);
      console.log('[RBAC-Middleware] user.role:', req.user?.role);
      console.log('[RBAC-Middleware] user.isSistema:', req.user?.isSistema);

      // Verificar que el usuario está autenticado
      if (!userId) {
        console.warn(`[RBAC] Unauthorized request to ${req.method} ${req.originalUrl}`);
        return res.status(401).json({
          error: 'UNAUTHORIZED',
          message: 'Usuario no autenticado'
        });
      }

      // Si RBAC está deshabilitado, pasar directamente
      if (!RBAC_ENABLED) {
        console.log(`[RBAC-SHADOW] ${req.method} ${req.originalUrl} - User: ${userId}, Permission: ${permission}`);
        return next();
      }

      // Verificar permiso
      const hasPermission = await rbacService.checkPermission({
        userId,
        storeId,
        permission
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
