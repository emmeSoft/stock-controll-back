# CONTEXTO DE TRASPASO: Proyecto Stock Control (Gentleman.Dots)

Este documento centraliza el estado actual del proyecto para facilitar el traspaso entre asistentes de IA. 

---

## 1. Información General del Proyecto (Baseline)

- **Stack Tecnológico**: 
  - **Backend**: Node.js + Express + Prisma ORM + PostgreSQL.
  - **Frontend**: React (Vite) + Zustand (Estado global) + Tailwind CSS.
- **Arquitectura**: Clean Architecture / Hexagonal (en proceso de refinamiento). Capas de servicios desacopladas de controladores.
- **Estado de Seguridad**: Auditado. Implementado "Sudo Mode" para acciones críticas, cookies `httpOnly`, y validación de integridad de archivos.
- **Sistema de Roles (RBAC)**: 
  - **Roles**: SISTEMA (Acceso global), ADMINISTRADOR (Por tienda), ENCARGADO, VENDEDOR.
  - **Permisos**: 45+ permisos atómicos controlados mediante middlewares.

---

## 2. El Objetivo Actual: Motor de Descuentos Universal

Estamos reemplazando el sistema legacy de descuentos (8 tipos rígidos con evaluadores separados) por un sistema de **Reglas Universales Componibles (AND Lógico)**.

### Axiomas de Diseño (Decisiones Firmes)
- **ITEM_LEVEL**: Aplica a productos/categorías específicos. Gana el de mayor impacto por ítem.
- **ORDER_LEVEL**: Aplica globalmente al subtotal residual.
- **Combinabilidad**: Se permite **1 regla ITEM + 1 regla ORDER** por ítem. Nunca dos de la misma capa.
- **Evaluación**: 1. ITEM -> 2. ORDER (sobre residual).

---

## 3. Estado de Fases (Universal Refactor)

### ✅ Fase 0: Paralelismo y Core
- Se creó el motor universal sin tocar el código de producción.
- **Archivos**: `services/discountEngine/universal/{calculator.js, evaluator.js, index.js}`.
- El motor ya sabe evaluar targets, condiciones de ticket (montos mínimos, medios de pago) y limitaciones de unidades.

### ✅ Fase 1: Schema y Validación Dual
- **Prisma**: Schema extendido con `engineVersion` ("legacy" | "universal") y `conditionsUniversal` (JSON).
- **Validación**: Implementado `validateConditionsDual()` en `validators.js`.
- **Tests**: 6 casos de prueba pasando (`tests/discountEngine/universal.test.js`).

### ⏳ Fase 2: Endpoint Único y Merge (SIGUIENTE PASO)
- **Objetivo**: Modificar `/api/discounts/preview`.
- **Lógica**: Detectar la versión de cada regla, ejecutar ambos motores y combinar (merge) los resultados en una respuesta unificada.
- **Migración**: Script para convertir reglas existentes al nuevo formato.

### ⏳ Fase 3: Frontend Híbrido
- Modificar el modal de creación de descuentos en el admin.
- Si `engineVersion == "universal"`, mostrar los toggles de condiciones (Target, Ticket, Units). Si es "legacy", mostrar la UI vieja por tipos.

---

## 4. Estructura de Datos (conditionsUniversal)

```json
{
  "target": { 
    "productIds": [], 
    "categoryIds": [] 
  },
  "ticketConditions": { 
    "paymentMethods": ["CASH", "TRANSFERENCIA"],
    "minAmount": 5000,
    "clientIds": [],
    "allClients": true
  },
  "itemConditions": { 
    "minQuantity": 3 
  },
  "constraints": { 
    "maxUnits": 10 
  }
}
```

---

## 5. Próximos Pasos Recomendados

1. **Backend**: Implementar la lógica de "Merge" en el controller de descuentos para soportar preview mixto.
2. **Backend**: Crear script de migración automática de reglas legacy a universal.
3. **Frontend**: Integrar `EntitySearchSelect` en el modal de descuentos para evitar el uso de textareas con IDs manuales.

---

## 6. Documentación Técnica de Referencia

- `stock-controll-back/openspec/`: Contiene los specs técnicos bajo protocolo SDD.
- `stock-control-docs/docs/`: Planes de acción de seguridad y auditorías previas.

---
*Última actualización: 5 de Abril 2026*
*Estado: Motor Core validado - Listo para integración en API (Fase 2).*

