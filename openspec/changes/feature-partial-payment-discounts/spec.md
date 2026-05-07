# Especificación: Descuentos Parciales por Medio de Pago

## Requisitos Funcionales

1.  **Nuevo Atributo de Regla**: Cada regla de descuento tendrá una propiedad `allowPartial` (booleana).
2.  **Comportamiento `allowPartial: false` (Por defecto)**:
    - La regla se aplica al **total de la orden**.
    - La regla solo es válida si el medio de pago (ej. Efectivo) cubre el 100% de lo que el cliente debe pagar.
3.  **Comportamiento `allowPartial: true`**:
    - La regla se aplica **proporcionalmente**.
    - El descuento se calcula únicamente sobre el monto pagado con el medio específico.
    - Ejemplo: Si el subtotal es $1000 y el cliente paga $200 en Efectivo (con un 10% de descuento y `allowPartial: true`), el descuento será de $20.

## Casos de Prueba

### Caso 1: Pago combinado con `allowPartial: false`
- **Subtotal**: $1000.
- **Regla**: 10% Off Efectivo, `allowPartial: false`.
- **Pagos**: $500 Efectivo, $500 Tarjeta.
- **Resultado Esperado**: Descuento $0. Total $1000.

### Caso 2: Pago combinado con `allowPartial: true`
- **Subtotal**: $1000.
- **Regla**: 10% Off Efectivo, `allowPartial: true`.
- **Pagos**: $500 Efectivo, $500 Tarjeta.
- **Resultado Esperado**: Descuento $50 (10% de los $500 de efectivo). Total $950.

### Caso 3: Pago único con `allowPartial: false`
- **Subtotal**: $1000.
- **Regla**: 10% Off Efectivo, `allowPartial: false`.
- **Pagos**: $1000 Efectivo.
- **Resultado Esperado**: Descuento $100. Total $900.
