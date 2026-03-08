require('dotenv').config();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const prisma = require(`../db/database.prisma`)



const loginUser = async (email, password) => {
   const user = await prisma['user'].findUnique({ where: { email } });


  if (email !== user.email || password !== user.password) {
    throw new Error('Credenciales incorrectas desde el backend');
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

module.exports = { loginUser };