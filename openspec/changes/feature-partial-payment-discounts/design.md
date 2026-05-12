# Diseño Técnico: Descuentos Proporcionales

## 1. Schema (Prisma)
Se añade el campo `allowPartial` a la tabla `DiscountRule`.
```prisma
model DiscountRule {
  // ... campos existentes
  allowPartial Boolean @default(false)
}
```

## 2. Motor Universal (Evaluación)
Modificar `validateTicketConditions` en `services/discountEngine/universal/evaluator.js`:
- Recibir `paymentBreakdown` en el context.
- Calcular `matchingAmount` sumando los montos de los medios permitidos.
- Si `!allowPartial` y `matchingAmount < orderSubtotal`: retornar `false`.
- Si `allowPartial` y `matchingAmount > 0`: retornar `true` y adjuntar `matchingAmount` a la regla para el calculador.

## 3. Motor Universal (Cálculo)
Modificar `resolveOrderDiscounts` en `services/discountEngine/universal/calculator.js`:
- Al calcular el `amount` del descuento:
  - Si `rule.allowPartial === true`: `discountAmount = matchingAmount * (percentage / 100)`.
  - Si no: `discountAmount = residualSubtotal * (percentage / 100)`.

## 4. Servicio (Backend)
Actualizar `services/discountService.js`:
- Incluir `allowPartial` en `sanitizeRuleInput` y `validateRuleBody`.
- Asegurar que el `preview` también envíe el `paymentBreakdown` al motor.

## 5. Casos de Borde
- **Monto de Pago > Subtotal**: El `matchingAmount` se debe topear al `residualSubtotal` para evitar descuentos negativos o inflados.
- **Múltiples Reglas**: Cada regla calculará su propio `matchingAmount` basado en sus medios de pago permitidos.
