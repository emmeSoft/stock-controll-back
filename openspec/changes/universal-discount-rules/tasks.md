# Tasks: Universal Discount Rules

## Fase 0: Paralelismo Total ✅ COMPLETA

- [x] 0.1 Crear directorio `services/discountEngine/universal/` para el motor paralelo
- [x] 0.2 Crear `services/discountEngine/universal/calculator.js` con lógica de cálculo monetario (simulateMonetaryImpact, applyDiscount)
- [x] 0.3 Crear `services/discountEngine/universal/evaluator.js` con lógica de filtrado por vigencia y evaluación por capas (ITEM/ORDER)
- [x] 0.4 Crear `services/discountEngine/universal/index.js` como entry point del motor universal (exporta runUniversalPipeline)
- [x] 0.5 Verificar que el sistema existente (`services/discountEngine/index.js`) sigue funcionando sin cambios

---

## Fase 1: Campo engineVersion + Motor Universal ✅ COMPLETA

- [x] 1.1 Extender schema Prisma: agregar campo `engineVersion String @default("legacy")` a model DiscountRule
- [x] 1.2 Extender schema Prisma: agregar campo `conditionsUniversal Json?` a model DiscountRule (nullable para backward compatibility)
- [x] 1.3 Ejecutar `npx prisma migrate dev` para aplicar los cambios de schema
- [x] 1.4 Crear función de validación dual en `services/discountEngine/validators.js`: `validateConditionsDual(conditions, engineVersion, type)`
- [x] 1.5 Crear script de test manual `tests/discountEngine/universal.test.js` (6 casos: ITEM, ORDER, combinados, maxUnits, vigencia, ticketConditions)
- [x] 1.6 Documentar interfaz de conditionsUniversal en comments del archivo evaluator.js

---

## Fase 2: Endpoint Único con Detección ✅ COMPLETA

> Spec: SC-2.1, SC-2.2, SC-2.3, SC-2.4

### 2.1 — Separación de reglas por engineVersion en el servicio

- [x] 2.1.1 En `services/discountService.js`, extraer helper `splitRulesByEngine(rules)` que separa en `{ legacyRules, universalRules }` (SC-2.1)
- [x] 2.1.2 Las reglas con `engineVersion` nulo o ausente DEBEN caer como legacy (backward compatible)
- [x] 2.1.3 Crear test manual `tests/discountEngine/split-rules.test.js` verificando separación correcta con reglas mixtas

### 2.2 — Ejecución dual en discountService.preview

- [x] 2.2.1 Importar `runUniversalPipeline` desde `./discountEngine/universal` en `discountService.js`
- [x] 2.2.2 Modificar método `preview()`: después del fetch de reglas, llamar a `splitRulesByEngine(rules)` 
- [x] 2.2.3 Ejecutar motor legacy SOLO con `legacyRules` inyectadas vía `context.rules` (no nuevo fetch)
- [x] 2.2.4 Ejecutar motor universal SOLO con `universalRules` pasadas como segundo arg a `runUniversalPipeline(context, universalRules)`
- [x] 2.2.5 Si `legacyRules` está vacío: motor legacy retorna resultado vacío (sin llamarlo con lista vacía que crashe)
- [x] 2.2.6 Si `universalRules` está vacío: motor universal retorna resultado vacío (ya lo maneja el motor, verificar)

### 2.3 — Merge de resultados en respuesta unificada

- [x] 2.3.1 Crear función helper `mergeEngineResults(legacyResult, universalResult, originalTotal)` en `services/discountService.js` (SC-2.3)
- [x] 2.3.2 `discountTotal` = suma de ambos `discountTotal` individuales
- [x] 2.3.3 `finalTotal` = `originalTotal - discountTotal` con guard `Math.max(..., 0.01)`
- [x] 2.3.4 `appliedDiscounts` = concatenar ambos arrays; añadir campo `engine: "legacy"|"universal"` a cada elemento
- [x] 2.3.5 `conditionalDiscounts` = concatenar ambos arrays (si existen)
- [x] 2.3.6 `warnings` = concatenar ambos arrays
- [x] 2.3.7 Verificar que los campo top-level (`originalTotal`, `discountTotal`, `finalTotal`, `appliedDiscounts`) mantienen el mismo shape para el frontend
- [x] 2.3.8 Crear test manual `tests/discountEngine/preview-merge.test.js` con un carrito con reglas mixtas (1 legacy + 1 universal)

### 2.4 — CRUD adaptado para reglas universales

- [x] 2.4.1 Modificar `sanitizeRuleInput()` en `discountService.js` para aceptar `engineVersion` y `conditionsUniversal` del body
- [x] 2.4.2 Modificar `validateRuleBody()` para usar `validateConditionsDual(conditions, engineVersion, type)` en lugar de la validación legacy directa
- [x] 2.4.3 Para reglas universales: `type` puede ser `null` (o un valor sentinel como `"UNIVERSAL"`); `layer` se infiere de `target` en conditionsUniversal
- [x] 2.4.4 Modificar el `create()` para que derive `layer` correctamente cuando `engineVersion: "universal"` (del target, no del type)
- [x] 2.4.5 Modificar el `update()` con la misma lógica que `create()`
- [x] 2.4.6 Crear test manual `tests/discountEngine/crud-universal.test.js` verificando create y update con reglas universales válidas e inválidas

---

## Fase 3: Frontend Modal Híbrido ✅ COMPLETA

> Spec: SC-3.1, SC-3.2, SC-3.3
> Nota: Cambios en el frontend (`stock-controll/`).

### 3.1 — Detección de engineVersion en DiscountFormModal

- [x] 3.1.1 En `DiscountFormModal.jsx`, agregar estado local `engineVersion` inicializado con `rule?.engineVersion ?? "legacy"`
- [x] 3.1.2 Agregar UI para seleccionar engine solo en modo "crear regla nueva" (botón toggle)
- [x] 3.1.3 Renderizar UI condicional: `engineVersion === "universal"` → Rule Builder, else → UI actual sin cambios (SC-3.1)

### 3.2 — UI del Rule Builder para reglas universales

- [x] 3.2.1 Crear componente `UniversalRuleBuilder.jsx` en `src/components/Discounts/`
- [x] 3.2.2 Campo "Target": selección de "Todos los productos (ORDER)" | "Productos específicos" | "Categorías"
  - Si "Productos específicos": mostrar selector con search de productos
  - Si "Categorías": mostrar selector de categorías
  - Si "Todos": target queda null (ORDER_LEVEL)
- [x] 3.2.3 Sección "Condiciones del Ticket" (ticketConditions):
  - Pills checkbox para métodos de pago (EFECTIVO, DEBITO, CREDITO, TRANSFERENCIA, QR)
  - Campo numérico para monto mínimo (minAmount)
  - Toggle "Todos los clientes" / selector de clientes específicos
- [x] 3.2.4 Sección "Condiciones del Item" (itemConditions): campo numérico para `minQuantity`
- [x] 3.2.5 Sección "Restricciones" (constraints): campo numérico para `maxUnits`
- [x] 3.2.6 Al guardar: construir payload con `engineVersion: "universal"`, `conditionsUniversal: {...}` omitiendo campos vacíos/null
- [x] 3.2.7 Todos los campos usan prefijo `u_` en form state para evitar colisión con legacy

### 3.3 — Compatibilidad con reglas legacy existentes

- [x] 3.3.1 `ruleToForm()` intacta — reglas legacy se cargan igual que antes (no hay regresión)
- [x] 3.3.2 Al guardar una regla legacy editada, el payload legacy no incluye `engineVersion` ni `conditionsUniversal`
- [x] 3.3.3 Badge de identificación en modo edición muestra el engine activo de la regla

---

## Fase 4: Deprecación y Cleanup ⏳ PENDIENTE

> Spec: SC-4.1, SC-4.2, SC-4.3
> ⚠️ DESTRUCTIVA — ejecutar solo cuando todas las reglas de producción están en formato universal

### 4.1 — Script de migración masiva

- [ ] 4.1.1 Crear `scripts/migrate-discount-rules.js`: fetchear todas las reglas con `engineVersion: "legacy"` activas
- [ ] 4.1.2 Para cada tipo legacy, definir la función `convertToUniversal(rule)`:
  - QUANTITY → `itemConditions: { minQuantity }` + target según productId/categoryId en conditions
  - CASH_PAYMENT → `ticketConditions: { paymentMethods }`
  - CLIENT → `ticketConditions: { clientIds, allClients }`
  - SPECIAL_DATE → sin conditionsUniversal extras (vigencia ya está en startsAt/endsAt)
  - PRODUCT → `target: { productIds }`
  - CATEGORY → `target: { categoryIds }`
  - MIN_AMOUNT → `ticketConditions: { minAmount }`
  - LIMITED_STOCK → `target: { productIds }` + `constraints: { maxUnits }`
- [ ] 4.1.3 Validar cada `conditionsUniversal` generado con `validateConditionsUniversal()` antes de persistir
- [ ] 4.1.4 Actualizar en DB: `prisma.discountRule.update({ data: { engineVersion: "universal", conditionsUniversal: {...} } })`
- [ ] 4.1.5 Logging: loguear totales (migradas, skipped, errores) al final del script
- [ ] 4.1.6 Probar el script en un ambiente de desarrollo/staging antes de producción

### 4.2 — Deprecación de campos legacy en schema

- [ ] 4.2.1 Hacer `conditions Json?` (nullable) en `prisma/schema.prisma`
- [ ] 4.2.2 Hacer `type DiscountType?` (nullable) en `prisma/schema.prisma`
- [ ] 4.2.3 Ejecutar `npx prisma migrate dev` con el schema actualizado
- [ ] 4.2.4 Verificar que ningún código de PATH CRÍTICO lea `rule.conditions` o `rule.type` sin chequeo null

### 4.3 — Eliminación de código legacy

- [ ] 4.3.1 Eliminar archivos: `services/discountEngine/evaluators/*.js` (todos los evaluadores legacy)
- [ ] 4.3.2 Eliminar o vaciar `services/discountEngine/pipeline.js` (sustituir por wrapper hacia universal)
- [ ] 4.3.3 Actualizar `services/discountEngine/index.js` para exportar solo las APIs del motor universal
- [ ] 4.3.4 Revisar y migrar constantes útiles de `layerMap.js` y `constants.js` al motor universal si se necesitan
- [ ] 4.3.5 Ejecutar todos los tests manuales disponibles y confirmar que pasan post-cleanup
- [ ] 4.3.6 Actualizar `CONTEXT-HANDOVER.md` marcando Fase 4 como completa

---

## Dependencias entre fases

```
F0 → F1 → F2.1 → F2.2 → F2.3
                 → F2.4
F2 → F3
F2 + F3 → F4 (solo cuando prod está migrada)
```

## Archivos afectados por fase

| Fase | Tipo | Archivos |
|------|------|----------|
| 0 | Backend | `services/discountEngine/universal/{calculator,evaluator,index}.js` |
| 1 | DB | `prisma/schema.prisma` |
| 1 | Backend | `services/discountEngine/validators.js` |
| 1 | Test | `tests/discountEngine/universal.test.js` |
| 2 | Backend | `services/discountService.js` |
| 2 | Test | `tests/discountEngine/{split-rules,preview-merge,crud-universal}.test.js` |
| 3 | Frontend | `DiscountFormModal.jsx`, `UniversalRuleBuilder.jsx` (nuevo) |
| 4 | Backend | `scripts/migrate-discount-rules.js` (nuevo) |
| 4 | DB | `prisma/schema.prisma` (campos nullable) |
| 4 | Cleanup | `services/discountEngine/evaluators/*.js` (eliminar), `pipeline.js` (eliminar) |

## Criterios de completitud por fase

| Fase | Criterio |
|------|----------|
| F2 | Preview retorna resultado unificado con reglas mixtas; CRUD acepta reglas universales |
| F3 | Modal crea y edita reglas universales con UI de toggles; reglas legacy siguen funcionando |
| F4 | Script migra todas las reglas; tests pasan post-cleanup; código legacy eliminado |

