# Proposal: Unificar Relaciones de Prisma a Estilo Relacional (Connect)

## Intent

Solucionar el error de validación en `prisma.stockHistory.create()` que ocurre al mezclar el estilo relacional (`connect`) con campos escalares (`productId`). Siguiendo la línea de trabajo iniciada en el commit `3d64674`, se unificarán todas las llamadas de creación de Prisma en la capa de servicios para usar exclusivamente el estilo **Relacional** (`connect`), eliminando la mezcla de estilos que causa fallos de validación.

## Scope

### In Scope
- Corregir las llamadas a `stockHistory.create` en `productsServices.js` (Carga inicial y ajuste manual).
- Unificar las llamadas `.create()` y `.update()` en todos los servicios para usar `connect`:
  - `suppliersServices.js`
  - `movimientosServices.js` (Verificar contra commit `3d64674`)
  - `discountService.js`
  - `clientServices.js`
  - `categoriesServices.js`
  - `cajaServices.js` (Verificar contra commit `3d64674`)
- Asegurar que no existan mezclas de estilos (ej. `storeId` junto a `user: { connect: ... }`).

### Out of Scope
- Cambios en las ramas remotas.
- Refactorización profunda de lógica de negocio.

## Capabilities

### New Capabilities
- `stock-history-integrity`: Garantizar que cada movimiento de stock se registre correctamente usando el estilo relacional unificado.

### Modified Capabilities
None

## Approach

Se utilizará el patrón **Relational Connect** de Prisma en todas las operaciones de escritura. 
En lugar de mezclar:
```javascript
data: {
  store: { connect: { id: storeId } },
  productId: productId // ERROR: Mezca de escalar y relacional
}
```
Se cambiará a un estilo 100% relacional:
```javascript
data: {
  store: { connect: { id: storeId } },
  product: { connect: { id: productId } }
}
```
Para campos opcionales, se usará: `user: userId ? { connect: { id: userId } } : undefined`.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `services/productsServices.js` | Modified | Fix en historial de stock usando `connect`. |
| `services/suppliersServices.js` | Modified | Unificación a estilo relacional. |
| `services/movimientosServices.js` | Modified | Asegurar consistencia con commit `3d64674`. |
| `services/discountService.js` | Modified | Unificación a estilo relacional. |
| `services/clientServices.js` | Modified | Unificación a estilo relacional. |
| `services/categoriesServices.js` | Modified | Unificación a estilo relacional. |
| `services/cajaServices.js` | Modified | Asegurar consistencia con commit `3d64674`. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| IDs nulos en campos requeridos | Low | Validaciones previas en servicios (ya existen). |
| Error en nombres de relaciones | Low | Verificar nombres de modelos en `schema.prisma`. |

## Rollback Plan

1. `git checkout services/*.js` para revertir localmente.
2. Deshacer el cambio de `connect` a ID directo si fuera necesario.

## Success Criteria

- [ ] `stockHistory.create` funciona sin errores de validación.
- [ ] Todos los servicios usan un estilo 100% relacional para escrituras.
- [ ] No se propagan errores por mezcla de estilos en nuevas funcionalidades.
