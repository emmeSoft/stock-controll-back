# Spec: Universal Discount Rules

**Change**: universal-discount-rules  
**Status**: F0 ✅ F1 ✅ F2 ⏳ F3 ⏳ F4 ⏳  
**Last updated**: 2026-04-07

---

## Overview

Migrar el motor de descuentos de 8 tipos rígidos (legacy) a un sistema de Reglas Universales Componibles. La migración es incremental y backward-compatible: las reglas legacy DEBEN seguir funcionando en producción hasta la Fase 4.

---

## Core Axioms (Non-Negotiable)

- **AXIOM-1**: Una regla ITEM y una regla ORDER pueden combinarse. Dos del mismo layer NO.
- **AXIOM-2**: La pipeline evalúa ITEM primero, ORDER aplica sobre el `residualSubtotal`.
- **AXIOM-3**: El campo `engineVersion` por regla es la única fuente de verdad para el routing.
- **AXIOM-4**: El `layer` (ITEM/ORDER) se infiere del campo `target`: con target → ITEM, sin target → ORDER.
- **AXIOM-5**: La estrategia para múltiples reglas es MAXIMIZE_DISCOUNT: gana la de mayor impacto monetario.
- **AXIOM-6**: El precio final de un producto NUNCA puede ser menor a $0.01 (guard mínimo).

---

## Phase 2: Endpoint Único con Detección Dual

### Context
El endpoint `POST /api/discounts/preview` actualmente solo ejecuta el motor legacy. Debe poder manejar un carrito donde convivan reglas con `engineVersion: "legacy"` y `engineVersion: "universal"` simultáneamente, retornando un resultado unificado.

---

### SC-2.1 — Separación de reglas por engineVersion

**Given** que el `discountService.preview` recibe un contexto de carrito,  
**When** se fetchean las `DiscountRule` activas desde DB para el `storeId`,  
**Then** el servicio DEBE separarlas en dos listas: `legacyRules` (donde `engineVersion = "legacy"` o nulo) y `universalRules` (donde `engineVersion = "universal"`).

**Acceptance criteria**:
- Las reglas legacy con `engineVersion` nulo DEBEN tratarse como legacy (backward compatible).
- La separación DEBE ocurrir ANTES de llamar a cualquier motor.
- Si `legacyRules.length === 0`, se DEBE saltar la ejecución del motor legacy sin error.
- Si `universalRules.length === 0`, se DEBE saltar la ejecución del motor universal sin error.

---

### SC-2.2 — Ejecución dual de motores

**Given** que las reglas ya están separadas por `engineVersion`,  
**When** hay al menos una regla en una lista,  
**Then** el servicio DEBE ejecutar cada motor solo para su lista de reglas correspondiente.

**Acceptance criteria**:
- El motor legacy (`runPipeline`) DEBE recibir únicamente `legacyRules` vía `context.rules`.
- El motor universal (`runUniversalPipeline`) DEBE recibir únicamente `universalRules`.
- Ambas ejecuciones son independientes — un error en una NO DEBE cancelar la otra.
- Si un motor recibe una lista vacía, DEBE retornar un resultado vacío (0 descuentos).

---

### SC-2.3 — Merge de resultados en respuesta unificada

**Given** que ambos motores han ejecutado y retornado sus resultados,  
**When** el servicio construye la respuesta final,  
**Then** DEBE producir un objeto unificado que combine ambos resultados.

**Acceptance criteria**:
- `originalTotal`: DEBE ser único, calculado una sola vez desde los items del carrito.
- `discountTotal`: DEBE ser la suma de `legacyResult.discountTotal + universalResult.discountTotal`.
- `finalTotal`: DEBE ser `originalTotal - discountTotal` con guard mínimo `$0.01`.
- `appliedDiscounts`: DEBE ser la concatenación de ambos arrays, cada elemento etiquetado con su `engine` ("legacy" | "universal").
- `conditionalDiscounts`: MUST incluir los condicionales de ambos motores.
- `warnings`: MUST incluir los warnings de ambos motores.
- La estructura del JSON de respuesta MUST ser backward-compatible: los campos existentes no cambian de nombre ni tipo.

---

### SC-2.4 — CRUD de reglas universales (create/update)

**Given** que un admin envía un `POST /api/discounts` con `engineVersion: "universal"`,  
**When** el servicio procesa el body,  
**Then** MUST validar `conditionsUniversal` en lugar de `conditions` con `validateConditionsDual()`.

**Acceptance criteria**:
- Si `engineVersion = "universal"`, el campo `conditionsUniversal` MUST estar presente y ser válido.
- Si `engineVersion = "legacy"` o ausente, el flujo de validación existente MUST permanecer intacto.
- El campo `type` SHOULD ser opcional para reglas universales (puede ser null o un valor default como "UNIVERSAL").
- El campo `layer` para reglas universales SHOULD inferirse de `target` (not from body).
- El `sanitizeRuleInput` MUST aceptar los nuevos campos sin romper los existentes.

---

## Phase 3: Frontend Modal Híbrido

### Context
El modal `DiscountFormModal.jsx` actualmente renderiza campos según el `type` de regla (8 tipos fijos). Debe adaptarse para detectar el `engineVersion` y renderizar la UI correspondiente.

---

### SC-3.1 — Detección de engineVersion en modal

**Given** que el modal se abre para crear o editar una regla,  
**When** la regla tiene `engineVersion: "universal"`,  
**Then** el modal MUST renderizar la UI del Rule Builder universal (toggles).  
**When** la regla tiene `engineVersion: "legacy"` o es nueva con preferencia legacy,  
**Then** el modal MUST renderizar la UI existente de tipos (sin cambios).

**Acceptance criteria**:
- La detección MUST ser automática, basada en el objeto regla recibido.
- No MUST haber doble modal — es el mismo componente con renderizado condicional.
- El toggle entre modos (si el admin crea una nueva regla) SHOULD ser explícito (botón/selector).

---

### SC-3.2 — UI del Rule Builder universal

**Given** que el modal está en modo universal,  
**When** el admin configura la regla,  
**Then** MUST poder definir los campos de `conditionsUniversal` mediante controles visuales.

**Acceptance criteria**:
- **target**: Selector de productos específicos O categorías O vacío (= ORDER level).
- **ticketConditions**: Toggles para `paymentMethods` (checkboxes: CASH, TARJETA, etc.), campo numérico para `minAmount`, selector de clientes o "todos".
- **itemConditions**: Campo numérico para `minQuantity`.
- **constraints**: Campo numérico para `maxUnits`.
- El payload generado al guardar MUST tener `conditionsUniversal` con la estructura correcta y `engineVersion: "universal"`.
- Los campos no completados MUST omitirse del JSON (no enviar `null` innecesario).

---

### SC-3.3 — Compatibilidad con reglas legacy existentes

**Given** que el modal muestra una regla existente con `engineVersion: "legacy"`,  
**When** el admin la edita,  
**Then** el flujo existente MUST funcionar sin cambios.

**Acceptance criteria**:
- Las reglas legacy MUST poder editarse sin necesidad de migrarlas al formato universal.
- No MUST producirse pérdida de datos al guardar una regla legacy desde el modal actualizado.

---

## Phase 4: Deprecación y Cleanup

### Context
Una vez que todas las reglas de producción han sido migradas a `engineVersion: "universal"`, se puede proceder a eliminar el código legacy.

---

### SC-4.1 — Script de migración masiva

**Given** que existen reglas en DB con `engineVersion: "legacy"`,  
**When** se ejecuta el script de migración `scripts/migrate-discount-rules.js`,  
**Then** MUST convertir cada regla legacy a su equivalente en formato universal.

**Acceptance criteria**:
- El script MUST ser idempotente (ejecutarlo dos veces no duplica datos).
- El script MUST loguear cuántas reglas migró, cuántas skipped y si hubo errores.
- La conversión MUST preservar el `percentage`, `startsAt`, `endsAt`, `isActive`, `priority`.
- El campo `conditionsUniversal` resultante MUST ser válido según `validateConditionsUniversal()`.
- Las reglas con types inmigrables (si existen) MUST ser logueadas como WARNING y skipped.

---

### SC-4.2 — Deprecación de campos legacy

**Given** que todas las reglas están en formato universal,  
**When** se procede con la cleanup,  
**Then** SHOULD marcarse como deprecated los campos `conditions`, `type`, `layer` del schema.

**Acceptance criteria**:
- Los campos deprecated SHOULD volverse nullable en el schema Prisma.
- El código de validación legacy (`validateConditions`) MAY permanecer como utilidad interna hasta la migración final.
- No MUST eliminarse campos de DB sin asegurarse que no hay código en producción leyéndolos.

---

### SC-4.3 — Eliminación de código legacy

**Given** que el sistema funciona completamente con el motor universal,  
**When** se procede con la limpieza final,  
**Then** MUST eliminarse los evaluadores legacy redundantes.

**Acceptance criteria**:
- Los archivos `services/discountEngine/evaluators/*.js` MUST eliminarse.
- El `pipeline.js` legacy MUST eliminarse o reemplazarse por un wrapper vacío.
- El `layerMap.js` y `constants.js` SHOULD migrarse/absorberse en el motor universal.
- Tras la cleanup, todos los tests existentes MUST seguir pasando.

---

## Non-Functional Requirements

- **Backward Compatibility**: El JSON de respuesta de `/api/discounts/preview` MUST mantener los mismos campos top-level hasta la Fase 4.
- **No downtime**: Las Fases 2 y 3 MUST poder desplegarse sin downtime (feature flags implícitos via `engineVersion`).
- **Security**: El `engineVersion` y `conditionsUniversal` en CREATE/UPDATE MUST sanearse server-side. El cliente NO DEBE poder inyectar `usedUnits`, `createdBy` o `layer`.
