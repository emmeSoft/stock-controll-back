const authServices = require('../services/authServices');
const prisma = require('../db/database.prisma');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const login = async (req, res) => {
  const { email, password } = req.body;

  try {
    const result = await authServices.loginUser(email, password);

    // Si requiere cambio de password
    if (result.requiresPasswordChange) {
      return res.json({
        message: result.message,
        requiresPasswordChange: true,
        user: result.user,
        setupToken: result.setupToken
      });
    }

    res.json({ message: result.message, user: result.user, token: result.token });
  } catch (error) {
    res.status(401).json({ message: error.message });
  }
};

const setupPassword = async (req, res) => {
  const { newPassword } = req.body;
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

  if (!token) {
    return res.status(401).json({ message: 'La sesión de configuración expiró. Iniciá sesión nuevamente con un nuevo PIN.' });
  }

  if (!newPassword || !newPassword.trim()) {
    return res.status(400).json({ message: 'La nueva contraseña es obligatoria.' });
  }

  if (newPassword.trim().length < 8) {
    return res.status(400).json({ message: 'La nueva contraseña debe tener al menos 8 caracteres.' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (decoded.purpose !== 'password-setup') {
      return res.status(403).json({ message: 'El token actual no es válido para definir la contraseña.' });
    }

    const result = await authServices.changeInitialPassword(decoded.id, newPassword.trim());

    return res.json({
      message: result.message,
      user: result.user,
      token: result.token
    });
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'La sesión de configuración expiró. Solicitá un nuevo PIN al administrador.' });
    }

    return res.status(400).json({ message: error.message || 'No se pudo actualizar la contraseña.' });
  }
};

const checkAuth = async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: { rbacRole: true, store: true }
    });

    if (!user) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }

    res.json(authServices.buildUserPayload(user));
  } catch (error) {
    res.status(500).json({ message: "Error al verificar sesión" });
  }
};

const verifySudo = async (req, res) => {
  const { password } = req.body;
  const adminId = req.user.id;

  try {
    if (!password) {
      return res.status(400).json({ message: "La contraseña es requerida." });
    }

    // SEGURIDAD (HIGH-004): Verificar rol ANTES de comparar contraseña.
    // Solo ADMINISTRADOR y SISTEMA pueden activar modo sudo.
    const allowedSudoRoles = ['ADMINISTRADOR', 'SISTEMA'];
    if (!allowedSudoRoles.includes(req.user.rbacRole)) {
      return res.status(403).json({ message: "No tenés permisos para activar el modo sudo." });
    }

    const adminRecord = await prisma.user.findUnique({ where: { id: adminId } });
    if (!adminRecord) {
      return res.status(404).json({ message: "Administrador no encontrado" });
    }

    const isValid = await bcrypt.compare(password, adminRecord.password);
    if (!isValid) {
      return res.status(403).json({ message: "Contraseña incorrecta. Acceso Sudo denegado." });
    }

    res.json({ message: "Sudo mode activado", sudoToken: authServices.signSudoToken(adminId) });
  } catch (error) {
    res.status(500).json({ message: "Error en validación Sudo" });
  }
};

const logout = async (req, res) => {
  res.json({ message: 'Sesión cerrada correctamente' });
};



module.exports = { login, setupPassword, checkAuth, verifySudo, logout };
