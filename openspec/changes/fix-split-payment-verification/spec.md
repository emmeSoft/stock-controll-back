# Especificación: Validación de Pagos Combinados

## Escenarios de Usuario

### Escenario 1: Venta combinada con descuento por método de pago
- **Dado** que el carrito suma $1000.
- **Y** existe una regla de "10% de descuento por pago en Efectivo".
- **Cuando** el vendedor ingresa un pago combinado: $500 Efectivo + $500 Tarjeta.
- **Entonces** el backend debe calcular el total final ($900).
- **Y** debe validar que la suma de los pagos ($1000) sea mayor o igual al total calculado ($900).
- **Y** la venta debe procesarse exitosamente.

### Escenario 2: Intento de manipulación de montos
- **Dado** que el total calculado por el backend es $1000.
- **Cuando** el frontend envía un desglose de pagos que suma $900.
- **Entonces** el backend debe rechazar la venta con un error 401 y el mensaje: "El monto total pagado es insuficiente".

## Requisitos Técnicos

1.  **Refactor de `validatePayments`**:
    - La validación debe cambiar de "Igualdad Estricta" (==) a "Suficiencia" (>=).
    - Si la suma de pagos > total calculado, la diferencia debe registrarse internamente como `change` (vuelto) si el modelo de datos lo permite, o simplemente ignorarse en la validación de integridad.

2.  **Ajuste del Motor de Descuentos**:
    - Las reglas de descuento por medio de pago deben seguir aplicándose si el medio de pago está presente en el `paymentBreakdown`.

3.  **Endpoint de Pre-validación (Opcional pero recomendado)**:
    - El POS debería poder llamar a `/api/sales/validate` (o usar el preview existente) para obtener el `computedFinalTotal` exacto antes de cerrar la venta.

## Reglas de Negocio
- El frontend **NUNCA** realiza el cálculo de descuentos ni del total final a pagar.
- El backend es el único autorizado para determinar el precio final de la orden.
