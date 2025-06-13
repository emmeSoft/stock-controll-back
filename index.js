const express = require('express');
const cors = require('cors');
const app = express();
require('dotenv').config();

const authRoutes = require('./routes/authRoutes');

app.use(cors({
  origin: 'http://localhost:5173',
  credentials: true
}));

app.use(express.json());
app.use('/api/auth', authRoutes);

app.listen(3000, () => {
  console.log('Servidor corriendo en http://localhost:3000');
});
