# Stock History Integrity Specification

## Purpose

Esta especificación define los requisitos para el registro íntegro de los movimientos de stock en el sistema, asegurando que cada cambio sea auditado correctamente usando el estilo relacional unificado de Prisma.

## Requirements

### Requirement: Registro de Movimiento de Stock

El sistema DEBE registrar una entrada en el historial de stock (`StockHistory`) cada vez que el stock de un producto cambie.

#### Scenario: Registro de carga inicial exitoso
- GIVEN un producto nuevo que se está creando con stock de 20 unidades
- WHEN el producto se guarda exitosamente en la base de datos
- THEN el sistema DEBE crear un registro en `StockHistory` con tipo `INITIAL`
- AND el `movementAmount` DEBE ser 20
- AND el `currentStock` DEBE ser 20

#### Scenario: Registro de ajuste manual exitoso
- GIVEN un producto existente con stock de 50 unidades
- WHEN el usuario ajusta el stock a 40 unidades manualmente
- THEN el sistema DEBE crear un registro en `StockHistory` con tipo `MANUAL_ADJUSTMENT`
- AND el `movementAmount` DEBE ser -10
- AND el `currentStock` DEBE ser 40

### Requirement: Consistencia Técnica de Prisma (Relational Style)

Para garantizar la interoperabilidad y evitar errores de validación cruzada, todas las llamadas a `prisma.stockHistory.create()` y similares DEBEN utilizar exclusivamente objetos de conexión relacional (`connect`) para vincular entidades, evitando la mezcla con campos escalares directos.

#### Scenario: Creación de StockHistory sin error de relación
- GIVEN los IDs de tienda (`storeId`), producto (`productId`) y usuario (`userId`)
- WHEN se invoca `prisma.stockHistory.create()` usando `store: { connect: ... }`, `product: { connect: ... }` y `user: { connect: ... }`
- THEN la operación DEBE completarse exitosamente
- AND no DEBE lanzarse el error `Invalid invocation` por mezcla de estilos.
