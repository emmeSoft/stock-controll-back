require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const app = express();

app.use(cookieParser());

// Configuración de Orígenes Permitidos
const allowedOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',') 
  : ["http://localhost:5173", "http://localhost:5174"];

// Middlewares de Seguridad
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      styleSrc: ["'self'", "'unsafe-inline'", "fonts.googleapis.com"],
      fontSrc: ["'self'", "fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "blob:", "res.cloudinary.com"],
      connectSrc: ["'self'", ...allowedOrigins]
    }
  }
})); // Protección de cabeceras HTTP y CSP

// Limitador de peticiones global
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 1000, // Límite de 1000 peticiones por cada 15 min (Carga de POS)
  message: { message: 'Demasiadas peticiones desde esta IP, por favor intenta de nuevo más tarde.' },
  standardHeaders: true, // Retorna info del límite en las cabeceras `RateLimit-*`
  legacyHeaders: false, // Desactiva las cabeceras `X-RateLimit-*`
});

// Limitador específico para Login (estricto)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 15, // 15 intentos por ventana
  message: { message: 'Demasiado intentos de login, intenta de nuevo en 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Limitador para Sudo y operaciones críticas (Extra estricto)
const sudoLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutos
  max: 5, // Solo 5 intentos
  message: { message: 'Límite de validaciones críticas excedido, intenta en 5 minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
});

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
const discountRoutes = require('./routes/discountRoutes');

app.use(cors({
  origin: function (origin, callback) {
    // Permitir peticiones sin origen (como apps móviles o curl) 
    // o si el origen está en la lista blanca
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('No permitido por la política de CORS de la aplicación'));
    }
  },
  credentials: true
}));

app.use(express.json());
app.use(limiter); // Aplicar el limitador global

// Rutas de autenticación con sus propios limitadores definidos en el router o aquí
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
app.use("/api/discounts", discountRoutes);
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
