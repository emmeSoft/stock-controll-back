# Fix: Tickets inmutables

## Problema
Los tickets en reportes muestran nombres actuales de descuentos en vez de los originales porque hacen JOIN dynamical a DiscountRule.

## Solución
En cajaServices.js - QUITAR el include de discountRule del appliedDiscounts.
El frontend debe usar `reason` directamente (que ya se guardó al crear la venta).

## Cambio
En cajaServices.js línea ~206:
```js
// ANTES (incorrecto - hace JOIN dinâmico):
appliedDiscounts: {
  include: {
    discountRule: true
  }
}

// DESPUÉS (correcto - solo trae lo guardado):
appliedDiscounts: true
```

El campo `reason` ya fue guardado al crear la venta y contiene el nombre original.