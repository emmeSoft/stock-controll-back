# Tareas: feature-partial-payment-discounts

## Backend & DB
- [ ] **T1: Base de Datos**
    - [ ] Agregar `allowPartial Boolean @default(false)` al modelo `DiscountRule` en `schema.prisma`.
    - [ ] Ejecutar `npx prisma db push` para actualizar la base de datos local.

- [ ] **T2: Servicio de Descuentos (`discountService.js`)**
    - [ ] Actualizar `sanitizeRuleInput` para incluir `allowPartial`.
    - [ ] Actualizar `validateRuleBody` si es necesario.
    - [ ] Asegurar que el método `preview` pase el `paymentBreakdown` al motor.

- [ ] **T3: Motor Universal - Evaluador (`evaluator.js`)**
    - [ ] Modificar `validateTicketConditions` para calcular el `matchingAmount` desde el `paymentBreakdown`.
    - [ ] Implementar la lógica de filtrado basada en `allowPartial`.

- [ ] **T4: Motor Universal - Calculador (`calculator.js`)**
    - [ ] Modificar `resolveOrderDiscounts` para usar el `matchingAmount` en el cálculo proporcional si aplica.

- [ ] **T5: Integración en Ventas (`salesServices.js`)**
    - [ ] Asegurar que el `paymentBreakdown` llegue correctamente al motor durante la creación de la venta.

## Frontend
- [ ] **T6: UI de Creación de Descuentos**
    - [ ] Agregar el checkbox "Aplicar solo sobre el monto abonado con este medio" en el formulario.
    - [ ] Vincular el campo con el estado y la API.

## Verificación
- [ ] **T7: Pruebas de Integración**
    - [ ] Probar Caso 1: Pago combinado, `allowPartial: false` -> Sin descuento.
    - [ ] Probar Caso 2: Pago combinado, `allowPartial: true` -> Descuento proporcional.
    - [ ] Probar Caso 3: Pago 100%, `allowPartial: false` -> Descuento total.
