const jwt = require('jsonwebtoken');
const prisma = require('../db/database.prisma');

const authMiddleware = async (req, res, next) => {
  // Intentar leer de cookies primero, luego de header como fallback
  let token = req.cookies?.token;

  if (!token && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    // No token: responder 401 silenciosamente
    return res.status(401).json({ message: 'No se proporcionó token de validación' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Verificar en la DB si el usuario sigue activo
    const dbUser = await prisma.user.findUnique({
      where: { id: decoded.id },
      include: { rbacRole: true }
    });

    if (!dbUser || dbUser.isActive === false) {
      return res.status(403).json({ message: 'Tu cuenta ha sido desactivada' });
    }

    // Obtener el nombre del rol RBAC
    const rbacRoleName = dbUser.rbacRole?.name || 'VENDEDOR';
    const rbacRoleId = dbUser.rbacRole?.id;

    req.user = decoded; // { id, email, role, storeId, ... }
    req.user.req = req; // Inyectamos req para que los servicios vean cookies si necesitan
    
    // Agregar información RBAC al usuario
    req.user.rbacRole = rbacRoleName;
    req.user.roleId = rbacRoleId;

    // Si no es SISTEMA y no tiene storeId asignado, no puede hacer nada
    if (rbacRoleName !== 'SISTEMA' && !decoded.storeId) {
       return res.status(403).json({ message: 'Usuario sin tienda asignada' });
    }

    // [New] Global Store Context: Si el Frontend envía la cabecera x-store-id
    // Y el usuario es SISTEMA, "falsificamos" temporalmente su req.user.storeId
    // para que todos los controladores actúen como si fuera un Admin Local de esa tienda.
    const activeStoreHeader = req.headers['x-store-id'];
    // console.log('[Auth] x-store-id header:', activeStoreHeader);
    // console.log('[Auth] rbacRoleName:', rbacRoleName);
    
    if (rbacRoleName === 'SISTEMA' && activeStoreHeader && activeStoreHeader !== "ALL") {
       req.user.storeId = activeStoreHeader;
       req.user.isGlobalOverride = true; // Flag para que los servicios sepán que es override
       // console.log('[Auth] SISTEMA con override, storeId:', activeStoreHeader);
    }

    // SISTEMA siempre tiene acceso global sin restricciones
    if (rbacRoleName === 'SISTEMA') {
       req.user.isSistema = true;
       // console.log('[Auth] SISTEMA flag set');
    }

    next();
  } catch (error) {
    return res.status(401).json({ message: 'Token inválido o expirado' });
  }
};

const requireRole = (roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.rbacRole)) {
      return res.status(403).json({ message: 'No tienes permisos para esta acción' });
    }
    next();
  };
};

module.exports = { authMiddleware, requireRole };
