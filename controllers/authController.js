const authServices = require('../services/authServices');
const prisma = require('../db/database.prisma');
const bcrypt = require('bcrypt');

const login = async (req, res) => {
  const { email, password } = req.body;

  try {
    const result = await authServices.loginUser(email, password);
    
    // Si requiere cambio de password
    if (result.requiresPasswordChange) {
      return res.json(result); 
    }

    // Setear la cookie
    res.cookie('token', result.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 60 * 60 * 1000 // 1 h
    });

    res.json({ message: result.message, user: result.user });
  } catch (error) {
    res.status(401).json({ message: error.message });
  }
};

const checkAuth = async (req, res) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.user.id },
            select: { id: true, email: true, firstName: true, lastName: true, role: true, storeId: true, profilePicture: true }
        });
        res.json(user);
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



module.exports = { login, checkAuth, verifySudo, logout };
