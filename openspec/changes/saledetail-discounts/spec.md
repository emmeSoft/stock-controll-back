# Spec: SaleDetail con Detalle de Descuentos

## Objetivo
El modal de "Venta Realizada con Éxito" debe mostrar el detalle de descuentos aplicados (igual que DiscountSummaryModal).

## Estado Actual
- SaleDetail muestra productos, total y método de pago
- NO muestra descuentos aplicados
- Backend ya devuelve appliedDiscounts con: productId, percentage, name, layer, amount

## Requerimientos

### R1: Mostrar descuentos por producto
- Cada descuento debe aparecer debajo del producto al que aplica
- Formato: `[PORCENTAJE%] → NOMBRE -MONTO`
- Si no tiene porcentaje, omitir badge

### R2: Mostrar descuentos globales
- Sección al final del ticket
- Label: "Descuentos Globales"
- Mismo formato que por producto

### R3: Orden-visual
- Productos con sus descuentos
- Subtotal por producto
- Descuentos globales al final
- Total final

## Archivo a modificar
- `src/pages/sales/SaleDetail.jsx`

## Notas
- Reutilizar lógica de DiscountSummaryModal.jsx
- Separar itemDiscounts (con productId) y orderDiscounts (sin productId)
- Usar helper getProductDiscounts(productId)