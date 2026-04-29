# Design: Unificación de Relaciones Prisma a Estilo Relacional

## Technical Approach

La estrategia consiste en migrar todas las operaciones de escritura de Prisma al patrón **Relacional (Connect)**. Esto alinea el código con las correcciones ya realizadas en `cajaServices.js` y `movimientosServices.js`, evitando el error de "estilo mixto" que bloquea la creación de registros de historial.

## Architecture Decisions

### Decision: Uso de Estilo Relacional (connect) sobre Escalar

**Choice**: Utilizar objetos `connect` para todas las relaciones en el objeto `data`.
**Alternatives considered**: Unificar a estilo escalar (Unchecked).
**Rationale**: Aunque el estilo escalar es más directo, el usuario reportó fallos previos con él en otros servicios. El estilo relacional, aunque más verboso, es el estándar de Prisma para manejar la integridad referencial desde la aplicación y soluciona el error de mezcla de estilos detectado.

### Decision: Manejo de Relaciones Opcionales

**Choice**: Usar el patrón condicional `relation: id ? { connect: { id } } : undefined`.
**Rationale**: Evita enviar objetos `connect` con IDs nulos/undefined, lo cual causaría un error fatal de Prisma.

## Data Flow

    Request (Controller) ──→ Service (Connect Objects) ──→ Prisma (Relational Input) ──→ DB

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `services/productsServices.js` | Modify | Unificar `stockHistory.create` y `product.create` a estilo relacional. |
| `services/suppliersServices.js` | Modify | Unificar `supplier.create` a estilo relacional. |
| `services/movimientosServices.js` | Modify | Asegurar que se mantiene el estilo del commit `3d64674`. |
| `services/discountService.js` | Modify | Unificar creación de reglas a estilo relacional. |
| `services/clientServices.js` | Modify | Unificar creación de clientes a estilo relacional. |
| `services/categoriesServices.js` | Modify | Unificar creación de categorías a estilo relacional. |
| `services/cajaServices.js` | Modify | Asegurar que se mantiene el estilo del commit `3d64674`. |

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Manual | Flujo de Stock | Crear producto -> Verificar `StockHistory` -> Ajustar stock -> Verificar `StockHistory`. |
| Manual | Regresión de Caja | Abrir/Cerrar caja y verificar que las relaciones `openedByUser` y `closedByUser` persisten. |

## Open Questions

- Ninguna por el momento. El camino relacional está validado por el usuario.
