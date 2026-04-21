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

    // Actualizamos la información del usuario con la de la base de datos actual
    req.user = {
      ...decoded,
      storeId: dbUser.storeId, // Sincronización Real-time: El JWT ya no manda sobre el storeId (SC-2.0 Fix)
      rbacRole: rbacRoleName,
      roleId: rbacRoleId,
      isSistema: rbacRoleName === 'SISTEMA'
    };

    req.user.req = req; 
    
    // [New] Global Store Context: Si el Frontend envía la cabecera x-store-id
    // Y el usuario es SISTEMA, "falsificamos" temporalmente su req.user.storeId
    const activeStoreHeader = req.headers['x-store-id'];
    
    if (req.user.isSistema) {
       // Si es SISTEMA y selecciona una tienda específica, aplicamos el override
       if (activeStoreHeader && activeStoreHeader !== "ALL") {
          req.user.storeId = activeStoreHeader;
          req.user.isGlobalOverride = true;
       } else {
          // Si es SISTEMA y está en "ALL" (Global), nos ASEGURAMOS de que el storeId sea null
          // Esto previene que use un storeId "basura" que pueda tener en su perfil de la DB
          req.user.storeId = null;
          req.user.isGlobalOverride = false;
       }
    }

    // Validación de integridad: Si no es SISTEMA y no tiene tienda, fuera.
    if (!req.user.isSistema && !req.user.storeId) {
       return res.status(403).json({ message: 'Tu cuenta no tiene una tienda asignada para operar.' });
    }

    // [Simulation Mode] Solo SISTEMA puede activar la simulación de roles.
    if (req.user.isSistema) {
       const SIMULABLE_ROLES = ['ADMINISTRADOR', 'ENCARGADO', 'VENDEDOR'];
       const simulatedRole = req.headers['x-simulated-role'];
       
       if (simulatedRole && SIMULABLE_ROLES.includes(simulatedRole)) {
         req.user.simulatedRole = simulatedRole;
         req.user.isSimulating = true;

         // REGLA CRÍTICA: Si simula un rol operativo, DEBE tener una tienda seleccionada.
         // No se puede ser "Vendedor" en el limbo de "TODAS LAS TIENDAS".
         if (!req.user.storeId) {
            return res.status(403).json({ 
                message: 'Para simular este rol operativo, debes seleccionar una tienda específica primero.' 
            });
         }
       }
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
