# Tasks: Universal Discount Rules

## Fase 0: Paralelismo Total

- [x] 0.1 Crear directorio `services/discountEngine/universal/` para el motor paralelo
- [x] 0.2 Crear `services/discountEngine/universal/calculator.js` con lógica de cálculo monetario (simulateMonetaryImpact, applyDiscount)
- [x] 0.3 Crear `services/discountEngine/universal/evaluator.js` con lógica de filtrado por vigencia y evaluación por capas (ITEM/ORDER)
- [x] 0.4 Crear `services/discountEngine/universal/index.js` como entry point del motor universal (exporta runUniversalPipeline)
- [x] 0.5 Verificar que el sistema existente (`services/discountEngine/index.js`) sigue funcionando sin cambios

## Fase 1: Campo engineVersion + Motor Universal

- [x] 1.1 Extender schema Prisma: agregar campo `engineVersion String @default("legacy")` a model DiscountRule
- [x] 1.2 Extender schema Prisma: agregar campo `conditionsUniversal Json?` a model DiscountRule (nullable para backward compatibility)
- [x] 1.3 Ejecutar `npx prisma migrate dev` para aplicar los cambios de schema
- [x] 1.4 Crear función de validación dual en `services/discountEngine/validators.js`: `validateConditionsDual(conditions, engineVersion)`
- [x] 1.5 Crear script de test manual `tests/discountEngine/universal.test.js` para verificar UniversalEvaluator con casos ITEM + ORDER
- [x] 1.6 Documentar interfaz de conditionsUniversal en comments del archivo evaluator.js

## Dependencias entre tareas

| Tarea | Depende de |
|-------|------------|
| 0.2 | 0.1 |
| 0.3 | 0.2 |
| 0.4 | 0.3 |
| 0.5 | 0.4 |
| 1.1 | 0.5 |
| 1.2 | 1.1 |
| 1.3 | 1.2 |
| 1.4 | 1.3 |
| 1.5 | 0.4 |
| 1.6 | 0.3 |

## Archivos afectados por fase

| Fase | Tipo | Archivos |
|------|------|----------|
| 0 | Backend | `services/discountEngine/universal/calculator.js`, `evaluator.js`, `index.js` |
| 1 | DB | `prisma/schema.prisma` |
| 1 | Backend | `services/discountEngine/validators.js` |
| 1 | Test | `tests/discountEngine/universal.test.js` |

## Criterios de completitud

- Sistema legacy debe funcionar igual que antes al finalizar Fase 0
- Motor universal debe poder ejecutarse de forma independiente (sin afectar reglas legacy)
- Schema debe ser backward compatible (reglas existentes sin engineVersion funcionan igual)
