const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../db/connection');
require('dotenv').config();

// const user = {
//   id: 1,
//   name: 'Pepe Pérez',
//   role: 'admin',
//   email: 'usuario@example.com',
//   password: '123456', // En la práctica esto estaría hasheado
//   profilePic: 'https://example.com/profile.jpg', // URL de la imagen de perfil
// };

const loginUser = async (email, password) => {
  const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email]); 
//  aqui deberia reemplazar por la funcion de ORM
// EJEMPLO userModel.findOne({ where: { email } });

  if (email !== rows[0].email || password !== rows[0].password) {
    throw new Error('Credenciales incorrectas desde el backend');
  }

  // if (rows.length === 0) {
  //   throw new Error('Usuario no encontrado');
  // }

  // const user = rows[0];
  // const validPassword = await bcrypt.compare(password, user.password);

  // if (!validPassword) {
  //   throw new Error('Contraseña incorrecta');
  // }

  const token = jwt.sign({ id: rows[0].id, email: rows[0].email }, process.env.JWT_SECRET, {
    expiresIn: '1h'
  });

  return {
    message: 'Login exitoso',
    token,
    user: {
      id: rows[0].id,
      name : rows[0].name,
      email: rows[0].email,
      role: rows[0].role,
      profilePic: rows[0].profilePic 
    }
  };
};

module.exports = { loginUser };
