const jwt = require('jsonwebtoken');

const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.log("no hay header o no empieza con Bearer")
    return res.status(401).json({ message: 'No se proporcionó token de validación' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // { id, email, role, storeId, ... }
    
    // Si no es un SUPERADMIN y no tiene storeId asignado, no puede hacer nada
    if (decoded.role !== 'SUPERADMIN' && !decoded.storeId) {
       return res.status(403).json({ message: 'Usuario sin tienda asignada' });
    }

    // [New] Global Store Context: Si el Frontend envía la cabecera x-store-id
    // Y el usuario es SUPERADMIN, "falsificamos" temporalmente su req.user.storeId
    // para que todos los controladores actúen como si fuera un Admin Local de esa tienda.
    const activeStoreHeader = req.headers['x-store-id'];
    if (decoded.role === 'SUPERADMIN' && activeStoreHeader && activeStoreHeader !== "ALL") {
       req.user.storeId = activeStoreHeader;
    }

    next();
  } catch (error) {
    return res.status(401).json({ message: 'Token inválido o expirado' });
  }
};

const requireRole = (roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'No tienes permisos para esta acción' });
    }
    next();
  };
};

module.exports = { authMiddleware, requireRole };
