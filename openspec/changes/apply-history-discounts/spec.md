# Spec: Incluir appliedDiscounts en history de caja

## Problema
El endpoint `/api/caja/history/all` no devuelve los descuentos aplicados, por lo que al ver un ticket desde reportes no se ven los descuentos.

## Solución
Agregar `appliedDiscounts: true` al include de Prisma en `cajaServices.js`

## Archivo a modificar
`stock-controll-back/services/cajaServices.js`

## Cambio específico
En la función `getGlobalHistory`, agregar `appliedDiscounts: true` al include.

Una vez hecho esto, también necesito verificar que `appliedDiscounts` incluya la relación `discountRule` para obtener nombre/percentage.