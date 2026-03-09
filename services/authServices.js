require('dotenv').config();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const prisma = require(`../db/database.prisma`)



const loginUser = async (email, password) => {
   const user = await prisma['user'].findUnique({ where: { email } });

  if (!user) {
    throw new Error('Credenciales incorrectas desde el backend');
  }

  const isPasswordValid = await bcrypt.compare(password, user.password);

  if (!isPasswordValid) {
    throw new Error('Credenciales incorrectas desde el backend');
  }

  // Si requiere cambio de contraseña, no devolvemos el token normal, sino uno temporal o una bandera
  if (user.mustChangePassword) {
    return {
      message: 'Se requiere cambio de contraseña',
      requiresPasswordChange: true,
      user: {
        email: user.email // Para que el frontend sepa a qué email cambiarle la clave
      }
    };
  }

  const token = jwt.sign(
    { id: user.id, email: user.email, role: user.role, storeId: user.storeId },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );

  return {
    message: 'Login exitoso',
    token,
    user: {
      id: user.id,
      firstName: user.firstName,
      email: user.email,
      role: user.role,
      storeId: user.storeId,
      profilePicture: user.profilePicture
    }
  };
};

const changeInitialPassword = async (email, newPassword) => {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error('Usuario no encontrado');

  const hashedPassword = await bcrypt.hash(newPassword, 10);

  await prisma.user.update({
    where: { email },
    data: {
      password: hashedPassword,
      mustChangePassword: false,
      tempPassword: null // Borramos el PIN por seguridad
    }
  });

  return { message: 'Contraseña actualizada correctamente. Reintenta hacer login.' };
}

module.exports = { loginUser, changeInitialPassword };