# RBAC - Control de Acceso Basado en Roles

## Visión General

Sistema de permisos implementado en Stock Control con 4 niveles de acceso jerárquicos.

## Roles

| Rol | Descripción | Acceso |
|-----|-------------|--------|
| **SISTEMA** | Mantenimiento técnico, acceso global | Todas las tiendas |
| **ADMINISTRADOR** | Decisiones de negocio, configuración | Su tienda |
| **ENCARGADO** | Control operativo diario | Su tienda |
| **VENDEDOR** | Ejecución de ventas, operaciones básicas | Su tienda |

## Permisos por Módulo

### USUARIOS
| Permiso | SISTEMA | ADMIN | ENCARGADO | VENDEDOR |
|---------|:-------:|:-----:|:---------:|:--------:|
| user.create | ✅ | ✅ (su tienda) | ❌ | ❌ |
| user.read | ✅ | ✅ (su tienda) | ✅ (su tienda) | ❌ |
| user.update | ✅ | ✅ (su tienda) | ❌ | ❌ |
| user.delete | ✅ | ❌ | ❌ | ❌ |
| user.manage-roles | ✅ | ✅ (su tienda) | ❌ | ❌ |

### TIENDAS
| Permiso | SISTEMA | ADMIN | ENCARGADO | VENDEDOR |
|---------|:-------:|:-----:|:---------:|:--------:|
| store.create | ✅ | ✅ | ❌ | ❌ |
| store.read | ✅ | ✅ (propia) | ✅ (propia) | ❌ |
| store.update | ✅ | ✅ (propia) | ❌ | ❌ |
| store.delete | ✅ | ❌ | ❌ | ❌ |

### PRODUCTOS
| Permiso | SISTEMA | ADMIN | ENCARGADO | VENDEDOR |
|---------|:-------:|:-----:|:---------:|:--------:|
| product.create | ✅ | ✅ | ✅ | ❌ |
| product.read | ✅ | ✅ | ✅ | ✅ |
| product.update | ✅ | ✅ | ✅ | ❌ |
| product.delete | ✅ | ✅ | ❌ | ❌ |
| product.price-change | ✅ | ✅ | ❌ | ❌ |

### CATEGORÍAS
| Permiso | SISTEMA | ADMIN | ENCARGADO | VENDEDOR |
|---------|:-------:|:-----:|:---------:|:--------:|
| category.create | ✅ | ✅ | ✅ | ❌ |
| category.read | ✅ | ✅ | ✅ | ✅ |
| category.update | ✅ | ✅ | ✅ | ❌ |
| category.delete | ✅ | ✅ | ❌ | ❌ |

### INVENTARIO
| Permiso | SISTEMA | ADMIN | ENCARGADO | VENDEDOR |
|---------|:-------:|:-----:|:---------:|:--------:|
| inventory.read | ✅ | ✅ | ✅ | ✅ |
| inventory.adjust | ✅ | ✅ | ✅ | ❌ |
| inventory.transfer | ✅ | ✅ | ✅ | ❌ |
| inventory.low-stock-alert | ✅ | ✅ | ✅ | ✅ |

### VENTAS
| Permiso | SISTEMA | ADMIN | ENCARGADO | VENDEDOR |
|---------|:-------:|:-----:|:---------:|:--------:|
| sale.create | ✅ | ✅ | ✅ | ✅ |
| sale.read | ✅ | ✅ | ✅ | ✅ (propias) |
| sale.cancel | ✅ | ✅ | ✅ (propia tienda) | ❌ |
| sale.refund | ✅ | ✅ | ✅ | ❌ |
| sale.discount | ✅ | ✅ | ✅ | ✅ |

### CLIENTES
| Permiso | SISTEMA | ADMIN | ENCARGADO | VENDEDOR |
|---------|:-------:|:-----:|:---------:|:--------:|
| client.create | ✅ | ✅ | ✅ | ✅ |
| client.read | ✅ | ✅ | ✅ | ✅ |
| client.update | ✅ | ✅ | ✅ | ❌ |
| client.delete | ✅ | ✅ | ❌ | ❌ |

### REPORTES
| Permiso | SISTEMA | ADMIN | ENCARGADO | VENDEDOR |
|---------|:-------:|:-----:|:---------:|:--------:|
| report.sales | ✅ | ✅ | ✅ | ✅ (propios) |
| report.inventory | ✅ | ✅ | ✅ | ❌ |
| report.financial | ✅ | ✅ | ❌ | ❌ |
| report.audit | ✅ | ✅ | ❌ | ❌ |

### CAJA
| Permiso | SISTEMA | ADMIN | ENCARGADO | VENDEDOR |
|---------|:-------:|:-----:|:---------:|:--------:|
| caja.open | ✅ | ✅ | ✅ | ✅ |
| caja.close | ✅ | ✅ | ✅ | ✅ |
| caja.read | ✅ | ✅ | ✅ | ✅ |
| caja.reconcile | ✅ | ✅ | ❌ | ❌ |

### CONFIGURACIÓN
| Permiso | SISTEMA | ADMIN | ENCARGADO | VENDEDOR |
|---------|:-------:|:-----:|:---------:|:--------:|
| config.read | ✅ | ✅ | ✅ | ❌ |
| config.update | ✅ | ✅ | ❌ | ❌ |

### AUDITORÍA
| Permiso | SISTEMA | ADMIN | ENCARGADO | VENDEDOR |
|---------|:-------:|:-----:|:---------:|:--------:|
| audit.read | ✅ | ✅ | ❌ | ❌ |
| audit.export | ✅ | ✅ | ❌ | ❌ |

## Uso en Rutas

### Ejemplo de Protección de Ruta

```javascript
const { requirePermission } = require('../middlewares/rbacMiddleware');

// Proteger ruta de productos
router.post('/', 
  requirePermission('product.create'), 
  productsController.createProduct
);

router.get('/', 
  requirePermission('product.read'), 
  productsController.getAllProducts
);
```

### Middleware RequirePermission

```javascript
const { requirePermission } = require('../middlewares/rbacMiddleware');

// Uso en cualquier ruta
router.post('/recurso', requirePermission('recurso.create'), controller.metodo);
```

## Variables de Entorno

| Variable | Descripción | Valor por defecto |
|----------|-------------|-------------------|
| `RBAC_ENABLED` | Habilita/deshabilita el sistema de permisos | `true` |

## Auditoría

Todos los cambios de roles se registran en la tabla `RoleAudit`:

- `userId`: Usuario cuyo rol fue cambiado
- `previousRoleId`: Rol anterior (null si es nuevo)
- `newRoleId`: Nuevo rol asignado
- `changedBy`: Usuario que realizó el cambio
- `reason`: Razón del cambio
- `createdAt`: Fecha del cambio

## API de Permisos

### checkPermission()
Verifica si un usuario tiene un permiso específico.

```javascript
const result = await rbacService.checkPermission({
  userId: 'user-123',
  storeId: 'store-456',
  permission: 'product.create'
});
// Retorna: true/false
```

### getUserPermissions()
Obtiene todos los permisos de un usuario.

```javascript
const permissions = await rbacService.getUserPermissions('user-123');
// Retorna: ['sale.create', 'sale.read', 'caja.open', ...]
```

### assignRole()
Asigna un rol a un usuario (requiere permiso `user.manage-roles`).

```javascript
await rbacService.assignRole({
  targetUserId: 'user-123',
  newRoleId: 'role-admin-id',
  assignedByUserId: 'user-admin',
  reason: 'Promoción a administrador'
});
```

## Troubleshooting

### Usuario recibe 403 Forbidden
1. Verificar que el usuario tiene el rol asignado en la tabla `User`
2. Verificar que el rol tiene el permiso necesario en la tabla `PermissionRole`
3. Para SISTEMA: verificar que el storeId existe en la tabla `Store`
4. Para otros roles: verificar que el `storeId` del usuario coincide con el del request

### Permiso no funciona
1. Verificar que el permiso existe en la tabla `Permission`
2. Verificar que está asignado al rol en `PermissionRole`
3. Verificar cache: `permissionsCache.clear()`

### Habilitar/Deshabilitar RBAC
```bash
# Deshabilitar (modo shadow - solo logs)
RBAC_ENABLED=false

# Habilitar (modo producción)
RBAC_ENABLED=true
```

## Base de Datos

### Tablas Principales

- **Role**: Catálogo de roles (SISTEMA, ADMINISTRADOR, ENCARGADO, VENDEDOR)
- **Permission**: Catálogo de permisos atómicos
- **PermissionRole**: Relación muchos-a-muchos entre roles y permisos
- **RoleAudit**: Log de cambios de roles

### Schema Prisma

```prisma
model Role {
  id          String           @id @default(cuid())
  name        RoleType         @unique
  description String?
  isSystem    Boolean          @default(false)
  permissions PermissionRole[]
  users       user[]
}

model Permission {
  id           String           @id @default(cuid())
  name         String           @unique
  description  String?
  category     String
  roles        PermissionRole[]
}

model PermissionRole {
  id           String     @id @default(cuid())
  roleId       String
  permissionId String
  role         Role       @relation(...)
  permission   Permission @relation(...)
}

model RoleAudit {
  id            String   @id @default(cuid())
  userId        String
  previousRoleId String?
  newRoleId     String
  changedBy     String
  reason        String?
  createdAt     DateTime @default(now())
}
```
