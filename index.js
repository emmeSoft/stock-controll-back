const express = require('express');
const cors = require('cors');
const app = express();
require('dotenv').config();

const authRoutes = require('./routes/authRoutes');
const clientRoutes = require('./routes/clientsRoutes');
const employeesRoutes = require('./routes/employeesRoutes');

app.use(cors({
  origin: 'http://localhost:5173',
  credentials: true
}));

app.use(express.json());
app.use('/api/auth', authRoutes);

app.use("/api/clients", clientRoutes);
app.use("/api/user", employeesRoutes)

app.listen(3000, () => {
  console.log('Servidor corriendo en http://localhost:3000');
});
