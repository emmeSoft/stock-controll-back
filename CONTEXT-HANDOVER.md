# CONTEXTO DE TRASPASO: Motor de Descuentos Universal

Este documento sirve para sincronizar el estado del proyecto entre asistentes de IA. Estamos en medio de una refactorización crítica del motor de descuentos.

## 1. El Objetivo
Evolucionar el motor de descuentos de una arquitectura de "Silos" (8 tipos rígidos: QUANTITY, CASH_PAYMENT, CLIENT, SPECIAL_DATE, PRODUCT, CATEGORY, MIN_AMOUNT, LIMITED_STOCK) a un sistema de **Reglas Universales Componibles (AND Lógico)**.

## 2. Arquitectura y Axiomas (Decisiones Firmes)

### Capas (Layers)
- **ITEM_LEVEL**: Reglas con `target` definido (productos/categorías). Gana la de mayor impacto monetario por producto.
- **ORDER_LEVEL**: Reglas globales (sin target). Gana la de mayor impacto sobre el subtotal residual.

### Combinabilidad
- Se permite **1 regla ITEM + 1 regla ORDER** por ítem.
- Prohibido sumar dos de la misma capa.

### Evaluación Secuencial
1. ITEM se aplica primero
2. ORDER aplica sobre residualSubtotal

---

## 3. Fases de Implementación (CORREGIDAS según plan)

### Fase 0: Paralelismo Total ✅ COMPLETA
- Motor universal creado en paralelo al legacy
- Archivos: `services/discountEngine/universal/{calculator.js, evaluator.js, index.js}`
- Sistema legacy intacto, sin cambios

### Fase 1: Schema + Validación Dual ✅ COMPLETA
- Schema Prisma extendido con `engineVersion` y `conditionsUniversal`
- Validación dual: `validateConditionsDual(conditions, engineVersion, type)`
- Tests passing: 6 casos cubriendo ITEM, ORDER, combos, maxUnits, vigencia, ticketConditions

### Fase 2: Endpoint Único con Detección ⏳ PENDIENTE
- Un solo endpoint `/api/discounts/preview`
- Controller detecta `engineVersion` por regla
- Ejecuta ambos motores (legacy + universal)
- Combina resultados (merge)
- Soporte para reglas mixtas simultáneamente

### Fase 3: Frontend Modal Híbrido ⏳ PENDIENTE
- Un solo modal en `/discounts`
- Detecta `engineVersion` de la regla
- Renderiza UI legacy (tipos) o UI universal (toggles) según corresponda

### Fase 4: Deprecación y Cleanup ⏳ PENDIENTE
- Migrar todas las reglas restantes a `universal`
- Deprecar campos `conditions`, `type`, `layer`
- Eliminar evaluadores legacy
- Limpieza de código

---

## 4. Estructura de Datos

### Schema Prisma (DiscountRule)
```prisma
type          DiscountType    // legacy: 8 tipos
conditions    Json            // legacy: shape por tipo
engineVersion String @default("legacy")  // "legacy" | "universal"
conditionsUniversal Json?    // universal: estructura unificada
layer         DiscountLayer // legacy: inferido del tipo
```

### conditionsUniversal (JSON)
```javascript
{
  target: { 
    productIds: string[],   // IDs de productos específicos (ITEM)
    categoryIds: string[]  // IDs de categorías (ITEM)
  },                        // null = ORDER_LEVEL
  ticketConditions: { 
    paymentMethods: string[],  // ["CASH", "TARJETA"]
    minAmount: number,        // monto mínimo para aplicar
    allClients: boolean,      // aplica a todos
    clientIds: string[]       // clientes específicos
  },
  itemConditions: { 
    minQuantity: number       // cantidad mínima de unidades
  },
  constraints: { 
    maxUnits: number          // unidades máximas con descuento
  }
}
```

---

## 5. Archivos Creados/Modificados

### Backend - Motor Universal
| Archivo | Descripción |
|---------|-------------|
| `services/discountEngine/universal/calculator.js` | simulateMonetaryImpact, applyDiscount, calculateResidualSubtotal |
| `services/discountEngine/universal/evaluator.js` | filterByVigency, splitByLayer, evaluateUniversal |
| `services/discountEngine/universal/index.js` | runUniversalPipeline (entry point) |

### Backend - Validación
| Archivo | Descripción |
|---------|-------------|
| `services/discountEngine/validators.js` | Agregado validateConditionsDual() |

### Backend - Schema
| Archivo | Descripción |
|---------|-------------|
| `prisma/schema.prisma` | Campos engineVersion y conditionsUniversal |

### Tests
| Archivo | Descripción |
|---------|-------------|
| `tests/discountEngine/universal.test.js` | 6 casos de prueba pasando |

---

## 6. Estado de Tasks (tasks.md)

```
Fase 0: Paralelismo Total
- [x] 0.1 Crear directorio universal/
- [x] 0.2 Crear calculator.js
- [x] 0.3 Crear evaluator.js
- [x] 0.4 Crear index.js
- [x] 0.5 Verificar sistema legacy intacto

Fase 1: Campo engineVersion + Motor Universal
- [x] 1.1 Campo engineVersion en schema
- [x] 1.2 Campo conditionsUniversal en schema
- [x] 1.3 Migración DB ejecutada
- [x] 1.4 Validación dual implementada
- [x] 1.5 Tests pasando (6 casos)
- [x] 1.6 Documentación JSDoc

Fase 2: Endpoint Único con Detección (PENDIENTE)
- [ ] 2.1 Modificar controller para detectar engineVersion
- [ ] 2.2 Ejecutar ambos motores
- [ ] 2.3 Merge de resultados

Fase 3: Frontend Modal Híbrido (PENDIENTE)
- [ ] 3.1 Detectar engineVersion en modal
- [ ] 3.2 UI adaptativa legacy/universal

Fase 4: Cleanup (PENDIENTE)
- [ ] 4.1 Migrar reglas restantes
- [ ] 4.2 Deprecar campos legacy
- [ ] 4.3 Eliminar código viejo
```

---

## 7. Tests Pasando

1. **ITEM only** - regla con target de productos
2. **ORDER only** - regla sin target (global)
3. **ITEM + ORDER combinados** - ambos aplicando
4. **maxUnits** - limitaciones de unidades
5. **Vigencia temporal** - startsAt/endsAt
6. **ticketConditions** - paymentMethods, minAmount, clientIds

---

## 8. Limitaciones Conocidas

- **maxUnits**: Aplica por item, no global. Mejora pendiente para futura iteración.
- **MAXIMIZE_DISCOUNT**: Versión actual aplica a las primeras unidades. La versión "las más caras" queda pendiente.

---

## 10. Plan Corregido — Implementación Incremental

### Fase 0: Paralelismo Total (SIN CAMBIOS EN PROD)
**Objetivo:** Construir el sistema nuevo sin romper el viejo

| Componente | Acción | Convive con viejo |
|------------|--------|-------------------|
| Motor | Crear `UniversalEvaluator` en paralelo | ✅ Ambos accesibles |
| Schema | Preparar campo `conditionsUniversal` | ✅ `conditions` sigue igual |
| Frontend | Crear nuevo modal como alternativa | ✅ Viejo sigue funcionando |

---

### Fase 1: Campo engineVersion + Motor Universal ✅ COMPLETA

#### 1.1 Extender Schema
```prisma
engineVersion String @default("legacy")  // "legacy" | "universal"
conditionsUniversal Json?  // { target, ticketConditions, itemConditions, constraints }
```

#### 1.2 Motor Universal
- Crear `UniversalEvaluator` en `services/discountEngine/universal/`

#### 1.3 Validación Dual (backend)
- El validador detecta formato por campo no nulo

---

### Fase 2: Endpoint Único con Detección ⏳ PENDIENTE

#### 2.1 Controller Inteligente
- Fetch rules con ambos formatos
- Separar por versión (legacy vs universal)
- Ejecutar ambos motores
- Combinar resultados (merge interno)

#### 2.2 Migración de Reglas Existentes
- Script convierte reglas al nuevo formato

---

### Fase 3: Frontend Modal Híbrido ⏳ PENDIENTE

#### 3.1 Detección en Modal
- Detectar `engineVersion` de la regla
- Renderizar UI legacy (tipos) o UI universal (toggles)

#### 3.2 Toggle de Preferencias (settings)
- Setting global `preferredEngine: "legacy" | "universal"`

---

### Fase 4: Deprecación y Limpieza ⏳ PENDIENTE

#### 4.1 Migración Masiva
- Convertir todas las reglas restantes a `engineVersion: "universal"`

#### 4.2 Deprecación de Campos Viejos
- `conditions` → nullable + warning
- `type` (enum) → ya no usado
- `layer` → inferido del target

#### 4.3 Limpieza de Código
- Eliminar evaluadores legacy

---

### Resumen por Fases

| Fase | Scope | Downtime | Riesgo |
|------|-------|----------|--------|
| **F0** | Motor nuevo paralelo | 0 | Ninguno |
| **F1** | Schema con engineVersion + motor | 0 | Schema nuevo sin datos |
| **F2** | Endpoint único con merge | Low | Lógica merge crítica |
| **F3** | Frontend híbrido | 0 | UI dual compleja |
| **F4** | Cleanup | Medium | Breaking final |

---

### Cambios Clave vs Plan Anterior

| Antes (inconsistente) | Después (corregido) |
|----------------------|-------------------|
| `conditionsUniversal` + `target` separados | `target` dentro de `conditionsUniversal` |
| Flag global `useUniversalRules` | Campo `engineVersion` por regla |
| Endpoint `/preview-universal` duplicado | Un solo endpoint con merge interno |
| Ruta `/discounts/universal` duplicada | Modal híbrido en `/discounts` |

---

### MVP (F0 → F1)

Versión mínima funcional:
1. Campo `engineVersion` agregado al schema
2. Campo `conditionsUniversal` con estructura completa
3. Motor Universal funcionando en paralelo
4. Validación dual detectando formato por campo no nulo

---

*Última actualización: 2 de Abril 2026*
*Estado: Fases 0 y 1 completadas - Listo para Fase 2*
