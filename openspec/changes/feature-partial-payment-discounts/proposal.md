# Propuesta: Descuentos Inteligentes por Medios de Pago

## Objetivo
Permitir que los descuentos vinculados a medios de pago (Efectivo, Transferencia, etc.) se apliquen de forma selectiva en pagos combinados.

## Cambios Requeridos

### 1. Base de Datos (Prisma)
Añadir el campo `allowPartial` a la tabla `DiscountRule`.
- `true`: El descuento se aplica solo sobre la porción pagada con ese medio.
- `false`: El descuento solo se aplica si el pago es 100% con ese medio.

### 2. Motor de Descuentos (Backend)
- **Contexto**: El motor ahora recibirá el objeto `paymentBreakdown` completo.
- **Evaluación**: Se validará el monto pagado contra el subtotal de la orden.
- **Cálculo**: Si es parcial, el descuento se calculará como `percentage * monto_del_medio` en lugar de `percentage * total_orden`.

### 3. Interfaz de Usuario (Frontend)
- Añadir checkbox "Permitir en pagos parciales" al crear/editar descuentos.
- Por defecto será `false` para mantener el comportamiento actual (seguridad).

## Ejemplo de Negocio
Venta de $1000 con regla "10% Off Efectivo":
- **Escenario A (`allowPartial: false`)**: 
    - Pago: $500 Efe + $500 Tarj. 
    - **Resultado**: No aplica descuento. Total $1000.
- **Escenario B (`allowPartial: true`)**:
    - Pago: $500 Efe + $500 Tarj.
    - **Resultado**: 10% de $500 = $50. Total $950.
