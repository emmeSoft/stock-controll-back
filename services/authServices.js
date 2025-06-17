require('dotenv').config();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const prisma = require(`../db/database.prisma`)



const loginUser = async (email, password) => {
   const user = await prisma['user'].findUnique({ where: { email } });
  console.log('MYUSER',user)
  // const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email]); 
//  aqui deberia reemplazar por la funcion de ORM
// EJEMPLO userModel.findOne({ where: { email } });

  if (email !== user.email || password !== user.password) {
    throw new Error('Credenciales incorrectas desde el backend');
  }

  // if (rows.length === 0) {
  //   throw new Error('Usuario no encontrado');
  // }

  // const user = user;
  // const validPassword = await bcrypt.compare(password, user.password);

  // if (!validPassword) {
  //   throw new Error('Contraseña incorrecta');
  // }

  const token = jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET, {
    expiresIn: '1h'
  });

  return {
    message: 'Login exitoso',
    token,
    user: {
      id: user.id,
      name : user.name,
      email: user.email,
      role: user.role,
      profilePic: user.profilePic 
    }
  };
};

module.exports = { loginUser };
