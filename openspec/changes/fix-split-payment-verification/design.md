# Diseño Técnico: Validación Flexible de Pagos

## Cambios en `services/salesServices.js`

### 1. Refactor de `validatePayments`
Modificar la firma y la lógica para permitir que el monto pagado exceda el calculado.

```javascript
function validatePayments(paymentBreakdown, computedTotal) {
  // ...
  const totalPaid = paymentBreakdown.reduce((sum, p) => sum + p.amount, 0);
  const tolerance = Math.max(0.01, computedTotal * 0.001);

  if (totalPaid < computedTotal - tolerance) {
    throw new Error(`Monto insuficiente...`);
  }
  // Si totalPaid > computedTotal, se acepta (es vuelto).
}
```

### 2. Manejo de la Cascada de Pagos
En el método `create`, ajustaremos cómo se guardan los `orderPayments` si hay un excedente. El objetivo es que la suma de los registros en `orderPayment` coincida con el `amount` de la orden para que la contabilidad cierre perfecta.

- **Estrategia**: Si hay excedente, restaremos la diferencia del primer medio de pago de tipo "EFECTIVO" encontrado (que es el que suele generar vuelto).

### 3. Mejora en la Respuesta del Backend
Añadir un campo `change` (vuelto) en la respuesta del JSON para que el frontend pueda mostrar al vendedor cuánto dinero devolver, sin haber tenido que calcularlo él mismo.

## Consideraciones de Seguridad
- Se mantiene el chequeo de `priceIntegrityDiff` para asegurar que el subtotal inicial coincida.
- La validación `totalPaid < computedTotal` sigue siendo estricta para evitar ventas a pérdida.
