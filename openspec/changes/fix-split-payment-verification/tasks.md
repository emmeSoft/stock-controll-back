# Tareas: fix-split-payment-verification

- [ ] **T1: Modificar `validatePayments`**
    - [ ] Cambiar validación de `Math.abs(...) > tolerance` a `totalPaid < computedTotal - tolerance`.
    - [ ] Actualizar mensaje de error para ser más descriptivo.

- [ ] **T2: Ajustar lógica de `create` en `salesServices.js`**
    - [ ] Calcular `surplus = totalPaid - computedFinalTotal`.
    - [ ] Si `surplus > 0`, ajustar el desglose de pagos para que la suma sea exacta al `computedFinalTotal`.
    - [ ] Añadir campo `change` al objeto de respuesta.

- [ ] **T3: Verificación de pagos No-CC**
    - [ ] Ajustar la validación específica de Cuenta Corriente para que también sea flexible con el excedente en la parte de efectivo/tarjeta.

- [ ] **T4: Validación final**
    - [ ] Realizar una venta de prueba (simulada) con montos combinados que superen el total para verificar el cálculo del vuelto.
