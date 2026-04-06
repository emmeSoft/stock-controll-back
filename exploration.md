# Exploration: Motor de Descuentos v3 — Estado del Backend

## Fecha
2026-04-02

## Estado General: ✅ BACKEND COMPLETO — LISTO PARA FASES 1-4

---

## 1. Schema/Models (Prisma)

| Componente | Estado | Detalle |
|---|---|---|
| `DiscountRule` | ✅ Completo | 16 campos, relaciones a `store`, `user`, `AppliedDiscount`. Índices en `[storeId, isActive]` y `[type]` |
| `AppliedDiscount` | ✅ Completo | Auditoría inmutable. FK a `order` y `discountRule`. Índices en `orderId` y `discountRuleId` |
| `DiscountType` enum | ✅ 8 tipos | `QUANTITY, CASH_PAYMENT, CLIENT, SPECIAL_DATE, PRODUCT, CATEGORY, MIN_AMOUNT, LIMITED_STOCK` |
| `DiscountLayer` enum | ✅ | `ITEM` (productos específicos) / `ORDER` (total de orden) |
| Migration SQL | ✅ Aplicada | `20260331131816_add_discount_engine` |
| Relaciones extras | ✅ | `order.discountTotal`, `store.maxDiscountPct` |

## 2. Servicio (`discountService.js`)

| Endpoint | Método | Estado | Descripción |
|---|---|---|---|
| `getAll` | ✅ | Lista todas las reglas (activas + inactivas) por tienda |
| `getById` | ✅ | Una regla por ID, con validación de ownership |
| `create` | ✅ | Crea regla. Layer derivado server-side (AXIOMA 1). Sanitización de input |
| `update` | ✅ | Actualiza regla. Recalcula layer si cambia type |
| `deactivate` | ✅ | Soft delete (isActive=false). Preserva auditoría |
| `activate` | ✅ | Reactiva regla |
| `preview` | ✅ | Ejecuta motor SIN persistir. Lee precios de DB |

**Seguridad**: `layer`, `usedUnits`, `createdBy` NUNCA se aceptan del body del request.

## 3. Controlador (`discountController.js`)

7 endpoints con manejo de errores y mapeo de status codes (404 para "no encontrada", 400 para validación).

## 4. Rutas (`discountRoutes.js`)

| Método | Path | Permiso RBAC | Roles |
|---|---|---|---|
| `POST` | `/api/discounts/preview` | `discount.read` | VENDEDOR, ENCARGADO, ADMIN, SISTEMA |
| `GET` | `/api/discounts` | `discount.read` | VENDEDOR, ENCARGADO, ADMIN, SISTEMA |
| `GET` | `/api/discounts/:id` | `discount.read` | VENDEDOR, ENCARGADO, ADMIN, SISTEMA |
| `POST` | `/api/discounts` | `discount.create` | ENCARGADO, ADMIN, SISTEMA |
| `PUT` | `/api/discounts/:id` | `discount.update` | ENCARGADO, ADMIN, SISTEMA |
| `PATCH` | `/api/discounts/:id/activate` | `discount.update` | ENCARGADO, ADMIN, SISTEMA |
| `PATCH` | `/api/discounts/:id/deactivate` | `discount.delete` | ADMIN, SISTEMA |

**Montaje**: `app.use('/api/discounts', discountRoutes)` — registrado en `index.js` línea 90.

## 5. Motor de Evaluación (`services/discountEngine/`)

### Arquitectura del Pipeline (10 pasos)
1. Fetch de reglas activas por tienda
2. Filtrado por vigencia temporal (startsAt/endsAt)
3. Validación de conditions por tipo (skip con warning, nunca crashea)
4. Derivación de layer desde DiscountType
5. Evaluación por evaluador específico
6. Separación por layer (ITEM vs ORDER)
7. Resolución conflictos ITEM (competitivo: gana mayor %)
8. Resolución combinabilidad ORDER (cooperativo con matriz)
9. Aplicación tope global `store.maxDiscountPct`
10. Cálculo final de montos

### Evaluadores (8/8 implementados)

| Evaluador | Tipo | Layer | Estado |
|---|---|---|---|
| `productEvaluator` | PRODUCT | ITEM | ✅ |
| `categoryEvaluator` | CATEGORY | ITEM | ✅ |
| `quantityEvaluator` | QUANTITY | ITEM | ✅ |
| `limitedStockEvaluator` | LIMITED_STOCK | ITEM | ✅ |
| `clientEvaluator` | CLIENT | ORDER | ✅ |
| `cashPaymentEvaluator` | CASH_PAYMENT | ORDER | ✅ |
| `specialDateEvaluator` | SPECIAL_DATE | ORDER | ✅ |
| `minAmountEvaluator` | MIN_AMOUNT | ORDER | ✅ |

### Archivos auxiliares
- `constants.js` — Prioridades default, matriz de combinabilidad, GUARD_MIN_PRICE (0.01), DEFAULT_STORE_CAP_PCT (50)
- `layerMap.js` — Mapa type→layer (AXIOMA 1)
- `validators.js` — Validación de conditions por tipo (AXIOMA 14)

## 6. Integración con Ventas (`salesServices.js`)

**Estado**: ✅ INTEGRACIÓN COMPLETA

El flujo de venta (`POST /api/sales`):
1. Lee precios de DB (nunca del frontend)
2. Ejecuta `runPipeline()` con la tx de Prisma
3. Maneja LIMITED_STOCK con decremento atómico dentro de la transacción
4. Persiste `AppliedDiscount` para cada descuento aplicado (AXIOMA 13: solo amount > 0)
5. Incluye `appliedDiscounts` en las respuestas de `getAll` y `getById`

---

## Cobertura por Fase del Frontend

| Fase | Descripción | Backend | Detalle |
|---|---|---|---|
| **Fase 1** | Listado de reglas CRUD | ✅ LISTO | `GET/POST/PUT/PATCH /api/discounts` |
| **Fase 2** | Crear/Editar regla | ✅ LISTO | Validación completa por tipo en service layer |
| **Fase 3** | Preview de descuentos | ✅ LISTO | `POST /api/discounts/preview` — mismo motor, sin persistir |
| **Fase 4** | Aplicar en venta POS | ✅ LISTO | Motor integrado en `salesServices.create()`, auditoría en `AppliedDiscount` |

---

## Riesgos / Notas

1. **Sin tests automatizados** para el motor de descuentos (no hay archivos en `tests/` para discount). Se recomienda agregar tests para cada evaluador.
2. **RBAC permissions**: Los permisos `discount.read`, `discount.create`, `discount.update`, `discount.delete` deben existir en la tabla `Permission` y estar asignados a roles. Verificar con `seedRbac.js`.
3. **Frontend debe enviar**: Para preview → `{ items: [{ id, quantity }], clientId?, paymentMethods?: [] }`. Para venta → `{ items: [{ id, quantity }], clientId?, paymentBreakdown: [{ method, amount }] }`.
