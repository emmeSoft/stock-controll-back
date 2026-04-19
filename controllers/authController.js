const authServices = require('../services/authServices');
const prisma = require('../db/database.prisma');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const buildCookieOptions = (maxAge) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  maxAge
});

const login = async (req, res) => {
  const { email, password } = req.body;

  try {
    const result = await authServices.loginUser(email, password);
    
    // Si requiere cambio de password
    if (result.requiresPasswordChange) {
      res.cookie('token', result.setupToken, buildCookieOptions(10 * 60 * 1000));

      return res.json({
        message: result.message,
        requiresPasswordChange: true,
        user: result.user
      }); 
    }

    // Setear la cookie
    res.cookie('token', result.token, buildCookieOptions(60 * 60 * 1000));

    res.json({ message: result.message, user: result.user });
  } catch (error) {
    res.status(401).json({ message: error.message });
  }
};

const setupPassword = async (req, res) => {
  const { newPassword } = req.body;
  const token = req.cookies?.token;

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

    res.cookie('token', result.token, buildCookieOptions(60 * 60 * 1000));

    return res.json({
      message: result.message,
      user: result.user
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
            include: { rbacRole: true }
        });

        if (!user) {
            return res.status(404).json({ message: 'Usuario no encontrado' });
        }

        res.json({
            id: user.id,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            role: user.rbacRole?.name || null,
            storeId: user.storeId,
            profilePicture: user.profilePicture
        });
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

        // Seteamos una cookie de 'sudo' que dura 2 minutos
        res.cookie('sudo', 'true', {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 2 * 60 * 1000 // 2 minutos
        });

        res.json({ message: "Sudo mode activado" });
    } catch (error) {
        res.status(500).json({ message: "Error en validación Sudo" });
    }
};

const logout = async (req, res) => {
    res.clearCookie('token');
    res.clearCookie('sudo'); // Limpiamos también el sudo por las dudas
    res.json({ message: 'Sesión cerrada correctamente' });
};



module.exports = { login, setupPassword, checkAuth, verifySudo, logout };
