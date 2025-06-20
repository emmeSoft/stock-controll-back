const express = require('express');
const cors = require('cors');
const app = express();
require('dotenv').config();

const authRoutes = require('./routes/authRoutes');
const clientRoutes = require('./routes/clientsRoutes');
const employeesRoutes = require('./routes/employeesRoutes');
const suppliersRoutes = require('./routes/suppliersRoutes');
const categoriesRoutes = require('./routes/categoriesRoutes');
const productsRoutes = require('./routes/productsRoutes');

app.use(cors({
  origin: 'http://localhost:5173',
  credentials: true
}));

app.use(express.json());
app.use('/api/auth', authRoutes);

app.use("/api/clients", clientRoutes);
app.use("/api/user", employeesRoutes);
app.use("/api/suppliers", suppliersRoutes);
app.use("/api/categories", categoriesRoutes); // creo que las categorias deberian tener un codigo unico de indentificacion que tambien deberia traerse desde la base de datos y mostrado al usuario (distinto al id de la categoria)
app.use("/api/products", productsRoutes); // mismo comentario para los productos.


app.listen(3000, () => {
  console.log('Servidor corriendo en http://localhost:3000');
});
