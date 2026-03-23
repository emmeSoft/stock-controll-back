require('dotenv').config();
const express = require('express');
const cors = require('cors');
const app = express();

const authRoutes = require('./routes/authRoutes');
const clientRoutes = require('./routes/clientsRoutes');
const employeesRoutes = require('./routes/employeesRoutes');
const suppliersRoutes = require('./routes/suppliersRoutes');
const categoriesRoutes = require('./routes/categoriesRoutes');
const productsRoutes = require('./routes/productsRoutes');
const imageRoutes = require('./routes/imageRoutes');
const salesRoutes = require('./routes/salesRoutes');
const storesRoutes = require('./routes/storesRoutes');
const cajaRoutes = require('./routes/cajaRoutes');
const movimientosRoutes = require('./routes/movimientosRoutes');
const stockHistoryRoutes = require('./routes/stockHistoryRoutes');
const sellerPerformanceRoutes = require('./routes/sellerPerformanceRoutes');

app.use(cors({
  origin: ["http://localhost:5173", "http://localhost:5174"],
  credentials: true
}));

app.use(express.json());
app.use('/api/auth', authRoutes);

app.use("/api/clients", clientRoutes);
app.use("/api/user", employeesRoutes);
app.use("/api/suppliers", suppliersRoutes);
app.use("/api/categories", categoriesRoutes); // creo que las categorias deberian tener un codigo unico de indentificacion que tambien deberia traerse desde la base de datos y mostrado al usuario (distinto al id de la categoria)
app.use("/api/products", productsRoutes); // mismo comentario para los productos.
app.use("/api/images", imageRoutes); 
app.use("/api/sales", salesRoutes);
app.use("/api/stores", storesRoutes);
app.use("/api/caja", cajaRoutes);
app.use("/api/movimientos", movimientosRoutes);
app.use("/api/stock-history", stockHistoryRoutes);
app.use("/api/seller-performance", sellerPerformanceRoutes);
app.listen(3000, () => {
  console.log('Servidor corriendo en http://localhost:3000');
});
