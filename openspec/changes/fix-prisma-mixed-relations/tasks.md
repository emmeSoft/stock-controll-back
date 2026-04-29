# Tasks: Unificación de Relaciones Prisma a Estilo Relacional

## Phase 1: Foundation & Verification

- [x] 1.1 Escanear `services/` para detectar llamadas a Prisma con estilos mixtos.
- [x] 1.2 Verificar en `schema.prisma` los nombres exactos de los campos de relación para los modelos afectados.

## Phase 2: Implementation (Stock & Products)

- [x] 2.1 Modificar `services/productsServices.js`: `stockHistory.create` en `create` (carga inicial) → estilo relacional completo.
- [x] 2.2 Modificar `services/productsServices.js`: `stockHistory.create` en `update` (ajuste manual) → estilo relacional completo.
- [x] 2.3 Modificar `services/productsServices.js`: `stockHistory.create` en `adjustStock` (transacción) → estilo relacional completo.

## Phase 3: Implementation (Global Unification)

- [x] 3.1 `services/suppliersServices.js` — Ya usaba `connect`. Sin cambios necesarios.
- [x] 3.2 `services/discountService.js` — Ya usaba `connect`. Sin cambios necesarios.
- [x] 3.3 `services/clientServices.js` — Ya usaba `connect`. Sin cambios necesarios.
- [x] 3.4 `services/categoriesServices.js` — Ya usaba `connect`. Sin cambios necesarios.
- [x] 3.5 `services/movimientosServices.js` — Arreglado en commit `3d64674`. Sin cambios necesarios.
- [x] 3.6 `services/cajaServices.js` — Arreglado en commit `3d64674`. Sin cambios necesarios.

## Phase 4: Verification

- [ ] 4.1 Test manual: Crear producto con stock inicial y validar que no hay error de Prisma.
- [ ] 4.2 Test manual: Realizar ajuste manual de stock y verificar la entrada en `StockHistory`.
- [ ] 4.3 Test manual: Verificar que la creación de otros modelos (proveedores, clientes) sigue funcionando.
