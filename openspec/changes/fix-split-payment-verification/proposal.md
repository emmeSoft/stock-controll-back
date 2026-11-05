# Propuesta: Solución para Verificación de Pagos Combinados

> **SUPERSEDED (2026-11-04)** — T1 below ("validación de suficiencia" in
> `validatePayments`) was implemented ad-hoc outside this change's tracking
> and is live in the current codebase (and its tolerance has since moved to
> a fixed value). T2-T4's "gross-leg surplus adjustment" design was never
> implemented and is superseded by the `cash-change-calculation` change,
> which instead keeps the cash leg NET from the start (received amount
> entered by the cashier, change computed and shown, never silently
> adjusted) — see `openspec/changes/cash-change-calculation/proposal.md`
> for the rejected-alternatives discussion. This folder is kept for
> historical context only; do not implement T2-T4 as written here.

## Problema
La validación de montos en el backend (`validatePayments`) es estrictamente nominal. Compara la suma de los medios de pago enviados por el frontend contra el total calculado por el motor de descuentos del backend. 

Cuando existen descuentos vinculados a un medio de pago (ej. "Efectivo"), el motor aplica el descuento al total de la venta si detecta ese método en la lista. Esto genera una discrepancia entre lo que el vendedor ingresó en el POS y lo que el backend calcula como precio final.

## Objetivos
- Mantener la regla de "Cero Cálculos en el Frontend" por seguridad.
- Permitir ventas combinadas sin errores de validación por discrepancias de descuentos.
- Asegurar que el monto cobrado sea el correcto según las reglas de negocio.

## Solución Propuesta

### 1. Mejorar el Motor de Descuentos (Granularidad)
Modificar el motor para que los descuentos por medio de pago se apliquen proporcionalmente al monto ingresado para ese método, en lugar de aplicarse al total de la orden de forma binaria.
*Nota: Esto es complejo y puede ser una fase 2.*

### 2. Validación Inteligente en `salesServices.js`
Modificar la lógica de `validatePayments` para manejar excedentes. Si el total enviado por el frontend supera el total calculado por el backend (debido a descuentos aplicados), el backend aceptará la venta y registrará el excedente como un ajuste o simplemente validará que el total pagado es *al menos* el total calculado.

### 3. Protocolo de Confirmación (Recomendado)
Implementar en el POS un paso de "Validación de Totales" que llame al endpoint de `preview` enviando el desglose de pagos. El backend devolverá el total final real. El POS entonces ajustará los montos de pago (ej. reduciendo el monto de efectivo si se aplicó un descuento) y el vendedor confirmará la venta con los valores ya conciliados por el backend.

## Riesgos
- **Sobre-cobro**: Si el backend descuenta y el vendedor cobra el monto original, el cliente paga de más. El sistema debe alertar esto.
- **Redondeo**: Los pagos combinados suelen tener problemas de centavos al aplicar porcentajes.

## Próximos Pasos
- Definir en la especificación cómo debe comportarse `validatePayments` ante pagos combinados.
- Actualizar el endpoint de preview para aceptar montos por medio de pago.
