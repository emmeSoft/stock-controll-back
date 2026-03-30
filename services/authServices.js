require('dotenv').config();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const prisma = require(`../db/database.prisma`)


const signAuthToken = (user) => {
  const roleName = user.rbacRole?.name || 'VENDEDOR';

  return jwt.sign(
    { id: user.id, email: user.email, role: roleName, storeId: user.storeId },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
};

const signPasswordSetupToken = (userId) => jwt.sign(
  { id: userId, purpose: 'password-setup' },
  process.env.JWT_SECRET,
  { expiresIn: '10m' }
);

const buildUserPayload = (user) => ({
  id: user.id,
  firstName: user.firstName,
  email: user.email,
  role: user.rbacRole?.name || 'VENDEDOR',
  storeId: user.storeId,
  storeName: user.store?.name,
  profilePicture: user.profilePicture
});



const loginUser = async (email, password) => {
   const user = await prisma['user'].findUnique({ 
     where: { email },
     include: { rbacRole: true, store: true }
   });

  if (!user) {
    throw new Error('Credenciales incorrectas desde el backend');
  }

  if (user.isActive === false) {
    throw new Error('Tu cuenta se encuentra dada de baja. Por favor, contacta al administrador.');
  }

  const isPasswordValid = await bcrypt.compare(password, user.password);

  if (!isPasswordValid) {
    throw new Error('Credenciales incorrectas desde el backend');
  }

  // Si requiere cambio de contraseña, invalidamos el PIN para que sea de uso único
  // y emitimos un token temporal exclusivo para completar el setup.
  if (user.mustChangePassword) {
    const consumedPinHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: consumedPinHash,
        mustChangePassword: true
      }
    });

    return {
      message: 'Se requiere cambio de contraseña',
      requiresPasswordChange: true,
      setupToken: signPasswordSetupToken(user.id),
      user: {
        email: user.email // Para que el frontend sepa a qué email cambiarle la clave
      }
    };
  }

  // Obtener nombre del rol RBAC
  return {
    message: 'Login exitoso',
    token: signAuthToken(user),
    user: buildUserPayload(user)
  };
};

const changeInitialPassword = async (userId, newPassword) => {
  const user = await prisma.user.findUnique({ 
    where: { id: userId },
    include: { rbacRole: true, store: true }
  });
  if (!user) throw new Error('Usuario no encontrado');

  if (!user.mustChangePassword) {
    throw new Error('Este usuario no tiene un cambio de contraseña pendiente.');
  }

  const hashedPassword = await bcrypt.hash(newPassword, 10);

  const updatedUser = await prisma.user.update({
    where: { id: userId },
    data: {
      password: hashedPassword,
      mustChangePassword: false
    },
    include: { rbacRole: true, store: true }
  });

  return {
    message: 'Contraseña actualizada correctamente.',
    token: signAuthToken(updatedUser),
    user: buildUserPayload(updatedUser)
  };
}

module.exports = { loginUser, changeInitialPassword };
