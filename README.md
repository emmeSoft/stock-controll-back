# Stock Control API - Motor de Gestión y POS

Backend robusto e industrial desarrollado en Node.js y Express, utilizando Prisma ORM con PostgreSQL. Administra el inventario, control de sesiones de caja (flujo de efectivo), cuentas corrientes de clientes, y ejecuta el motor de descuentos universal y sistema de permisos RBAC para la sucursal.

---

## Inicio Rápido (Local)

Para levantar el servidor de desarrollo en tu máquina local, seguí estos pasos:

### 1. Configurar Variables de Entorno
Crea un archivo `.env` en la raíz del proyecto basándote en la siguiente plantilla:

```env
PORT=3000
DATABASE_URL="postgresql://usuario:password@localhost:5432/stock_control?schema=public"
DIRECT_URL="postgresql://usuario:password@localhost:5432/stock_control?schema=public"
JWT_SECRET="tu_clave_secreta_super_segura"
ALLOWED_ORIGINS="http://localhost:5173,http://localhost:5174"

# Integración con Cloudinary
CLOUDINARY_CLOUD_NAME="tu_cloud_name"
CLOUDINARY_API_KEY="tu_api_key"
CLOUDINARY_API_SECRET="tu_api_secret"
```

### 2. Instalar Dependencias
Instalá los paquetes de Node:
```bash
npm install
```

### 3. Ejecutar Migraciones y Generar Cliente Prisma
Asegurate de aplicar las migraciones a la base de datos PostgreSQL y generar el cliente de Prisma:
```bash
npx prisma migrate dev
npx prisma generate
```

### 4. Poblar la Base de Datos (Seeding)
Poblá las tablas iniciales con roles, permisos básicos y datos semilla:
```bash
npx prisma db seed
```

### 5. Iniciar Servidor de Desarrollo
Corré el servidor local con recarga automática:
```bash
npm run dev
```
El servidor estará escuchando en `http://localhost:3000`.

---

## Arquitectura y Componentes Clave

El backend está diseñado de manera modular para separar responsabilidades limpiamente:

```
├── controllers/          # Controladores de la API (manejo de Req/Res)
├── routes/               # Definición de rutas y endpoints
├── services/             # Lógica de negocio pura (Servicios)
│   └── discountEngine/   # Motor Universal de Descuentos (evaluación y cálculo)
├── db/                   # Inicialización y cliente de base de datos
├── middlewares/          # Autenticación, validación de roles y control de adjuntos
├── prisma/               # Esquema de base de datos, migraciones y seeders
└── utils/                # Utilidades generales y helpers
```

### Motor Universal de Descuentos (services/discountEngine)
El motor evalúa las promociones vigentes de forma estructurada en cascada:
*   **ITEM_LEVEL**: Reglas aplicadas a productos o categorías específicas. Compiten por el descuento más alto.
*   **ORDER_LEVEL**: Reglas globales sobre el total residual de la orden (ej: pago en efectivo, clientes específicos).
*   **Tope Global (maxDiscountPct)**: Configurable por tienda (ej: 80% máximo de descuento) para evitar pérdidas financieras imprevistas.

### Seguridad y RBAC (Control de Acceso Basado en Roles)
*   **Roles**: `SISTEMA`, `ADMINISTRADOR`, `ENCARGADO` y `VENDEDOR`.
*   **Middlewares**: Controlan el acceso a nivel de endpoint mediante verificación estricta de permisos (`verifyPermission`).
*   **Protección IDOR**: Validación de propiedad (`storeId`) implementada en controladores críticos (ej: imágenes, productos) para evitar manipulaciones no autorizadas cruzadas entre sucursales.
*   **Hardening**: Rate limiters configurados de forma global y específicos para endpoints críticos (ej: Login con límite de 15 intentos por 15 minutos; operaciones Sudo con límite estricto).

---

## Scripts Disponibles

*   `npm run dev`: Inicia el servidor con `nodemon` en modo desarrollo.
*   `npm start`: Inicia el servidor en producción con `node`.
*   `npm run postinstall`: Genera automáticamente el cliente de Prisma tras instalar dependencias.

---

## Base de Datos y Modelado (Prisma Schema)

Los modelos principales configurados en `prisma/schema.prisma` representan:
*   **`store`**: Sucursales independientes con configuración propia (como `maxDiscountPct`).
*   **`user` & `Role` & `Permission`**: Soporte nativo para RBAC robusto.
*   **`product` & `categories`**: Catálogo de stock con soporte para códigos de barra dinámicos (`barcode`).
*   **`order` & `orderDetail` & `payment`**: Registros históricos de transacciones.
*   **`CashRegister` & `CashMovement`**: Auditoría financiera de aperturas, cierres y movimientos manuales de caja.
*   **`CurrentAccount` & `CurrentAccountMovement`**: Cuentas corrientes (crédito) para clientes registrados.
