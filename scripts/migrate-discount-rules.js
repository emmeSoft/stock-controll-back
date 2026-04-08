/**
 * migrate-discount-rules.js — Migración masiva legacy → universal
 * ─────────────────────────────────────────────────────────────────
 * Convierte todas las reglas activas con engineVersion 'legacy' al
 * formato universal, actualizando conditionsUniversal y engineVersion
 * en DB SIN tocar ni borrar el campo `conditions` original.
 *
 * SEGURIDAD:
 *  - Dry-run por defecto (no persiste). Pasar --execute para persistir.
 *  - Valida cada conditionsUniversal generado antes de tocar la DB.
 *  - Un error en una regla NO aborta las demás (continue con log).
 *
 * CUÁNDO EJECUTAR:
 *  - Solo cuando se confirme que el 100% de las reglas en producción
 *    pueden ser convertidas sin pérdida de información.
 *  - Ejecutar primero en staging con --execute, luego en producción.
 *
 * Uso:
 *   node scripts/migrate-discount-rules.js             # dry-run
 *   node scripts/migrate-discount-rules.js --execute   # persiste en DB
 *   node scripts/migrate-discount-rules.js --storeId=xyz  # solo esa tienda
 *
 * SC-4.1 (spec: openspec/changes/universal-discount-rules/spec.md)
 * ─────────────────────────────────────────────────────────────────
 */

'use strict';

const { PrismaClient } = require('@prisma/client');
const { validateConditionsDual } = require('../services/discountEngine/validators');

const prisma = new PrismaClient();

// ─────────────────────────────────────────────────────────────────
// Flags de ejecución (parseados desde argv)
// ─────────────────────────────────────────────────────────────────
const args    = process.argv.slice(2);
const DRY_RUN = !args.includes('--execute');
const storeArg = args.find((a) => a.startsWith('--storeId='));
const TARGET_STORE_ID = storeArg ? storeArg.split('=')[1] : null;

// ─────────────────────────────────────────────────────────────────
// convertToUniversal(rule)
// Mapea los tipos legacy al shape de conditionsUniversal.
// Retorna null si la regla no puede convertirse (skipped + log).
// ─────────────────────────────────────────────────────────────────
function convertToUniversal(rule) {
  const c = rule.conditions ?? {};
  const cu = {};

  switch (rule.type) {
    case 'QUANTITY': {
      // itemConditions: minQuantity
      if (c.minQuantity) {
        cu.itemConditions = { minQuantity: c.minQuantity };
      }
      // target: producto específico → ITEM, categoría → ITEM, global → ORDER (sin target)
      if (c.productIds?.length > 0) {
        cu.target = { productIds: c.productIds };
      } else if (c.categoryIds?.length > 0) {
        cu.target = { categoryIds: c.categoryIds };
      }
      // Modo global → sin target (ORDER level, pero con itemConditions)
      break;
    }

    case 'CASH_PAYMENT': {
      // ticketConditions: paymentMethods
      const methods = c.paymentMethods ?? ['EFECTIVO'];
      cu.ticketConditions = { paymentMethods: methods };
      break;
    }

    case 'CLIENT': {
      // ticketConditions: clientIds | allClients
      const tc = {};
      if (c.allClients === true) {
        tc.allClients = true;
      } else if (c.clientIds?.length > 0) {
        tc.clientIds = c.clientIds;
      } else {
        return null; // CLIENT sin clientIds ni allClients = inválida
      }
      cu.ticketConditions = tc;
      break;
    }

    case 'SPECIAL_DATE': {
      // La vigencia ya está en startsAt/endsAt.
      // La recurrencia YEARLY no tiene equivalente directo en el motor universal.
      // Se migra como ORDER (global) sin condiciones extra.
      // Si tenía recurrence, anotamos en ticketConditions como campo libre.
      if (c.recurrence) {
        // No hay campo en universal para esto aún — skip con warning
        return null; // requiere revisión manual
      }
      // Sin recurrence: migrar como ORDER global vacío (solo por vigencia)
      break;
    }

    case 'PRODUCT': {
      // target: productIds → ITEM level
      if (!c.productIds?.length) return null; // sin productos = inválida
      cu.target = { productIds: c.productIds };
      break;
    }

    case 'CATEGORY': {
      // target: categoryIds → ITEM level
      if (!c.categoryIds?.length) return null; // sin categorías = inválida
      cu.target = { categoryIds: c.categoryIds };
      break;
    }

    case 'MIN_AMOUNT': {
      // ticketConditions: minAmount
      if (!c.minAmount || c.minAmount <= 0) return null;
      cu.ticketConditions = { minAmount: c.minAmount };
      break;
    }

    case 'LIMITED_STOCK': {
      // target: productIds → ITEM level + constraints: maxUnits
      if (!c.productIds?.length) return null;
      cu.target = { productIds: c.productIds };
      if (c.maxUnits && c.maxUnits > 0) {
        cu.constraints = { maxUnits: c.maxUnits };
      }
      break;
    }

    default:
      return null; // tipo desconocido = skip
  }

  return cu;
}

// ─────────────────────────────────────────────────────────────────
// main()
// ─────────────────────────────────────────────────────────────────
async function main() {
  console.log('');
  console.log('══════════════════════════════════════════════════════════');
  console.log('  migrate-discount-rules.js');
  console.log(`  Modo: ${DRY_RUN ? '🟡 DRY-RUN (solo lee, no persiste)' : '🔴 EXECUTE (persiste cambios en DB)'}`);
  if (TARGET_STORE_ID) console.log(`  Tienda: ${TARGET_STORE_ID}`);
  console.log('══════════════════════════════════════════════════════════');
  console.log('');

  // ── 1. Fetch reglas legacy activas ──────────────────────────────
  const whereClause = {
    engineVersion: 'legacy',
    isActive:      true,
    ...(TARGET_STORE_ID ? { storeId: TARGET_STORE_ID } : {}),
  };

  const legacyRules = await prisma.discountRule.findMany({
    where: whereClause,
    orderBy: { createdAt: 'asc' },
  });

  console.log(`📋 Reglas legacy activas encontradas: ${legacyRules.length}`);

  if (legacyRules.length === 0) {
    console.log('✅ Nada que migrar. El sistema ya está limpio.');
    return;
  }

  // ── 2. Convertir y validar ────────────────────────────────────
  const results = {
    total:    legacyRules.length,
    migrated: 0,
    skipped:  0,
    errors:   [],
  };

  for (const rule of legacyRules) {
    const prefix = `  [${rule.id.slice(0, 8)}] "${rule.name}" (${rule.type})`;

    // Intentar conversión
    let conditionsUniversal;
    try {
      conditionsUniversal = convertToUniversal(rule);
    } catch (convErr) {
      console.error(`${prefix} → ❌ Error en convertToUniversal: ${convErr.message}`);
      results.errors.push({ id: rule.id, name: rule.name, reason: convErr.message });
      continue;
    }

    if (conditionsUniversal === null) {
      console.warn(`${prefix} → ⚠️  Skipped (no se puede convertir automáticamente)`);
      results.skipped++;
      continue;
    }

    // Validar el shape resultante
    const validationError = validateConditionsDual(conditionsUniversal, 'universal');
    if (validationError) {
      console.error(`${prefix} → ❌ conditionsUniversal inválidas: ${validationError}`);
      results.errors.push({ id: rule.id, name: rule.name, reason: validationError });
      continue;
    }

    // Log de la conversión
    console.log(`${prefix} → ✅`);
    if (DRY_RUN) {
      console.log(`        conditionsUniversal: ${JSON.stringify(conditionsUniversal)}`);
    }

    // ── 3. Persistir (solo en --execute) ─────────────────────────
    if (!DRY_RUN) {
      try {
        await prisma.discountRule.update({
          where: { id: rule.id },
          data: {
            engineVersion:      'universal',
            conditionsUniversal: conditionsUniversal,
            // conditions y type NO se borran → backward-compat durante la transición
          },
        });
      } catch (dbErr) {
        console.error(`${prefix} → ❌ Error de DB: ${dbErr.message}`);
        results.errors.push({ id: rule.id, name: rule.name, reason: dbErr.message });
        continue;
      }
    }

    results.migrated++;
  }

  // ── 4. Resumen ────────────────────────────────────────────────
  console.log('');
  console.log('══════════════════════════════════════════════════════════');
  console.log('  RESUMEN DE MIGRACIÓN');
  console.log('══════════════════════════════════════════════════════════');
  console.log(`  Total procesadas : ${results.total}`);
  console.log(`  Migradas         : ${results.migrated} ${DRY_RUN ? '(simulado)' : '✅'}`);
  console.log(`  Skipped          : ${results.skipped} (requieren revisión manual)`);
  console.log(`  Errores          : ${results.errors.length}`);

  if (results.errors.length > 0) {
    console.log('');
    console.log('  Reglas con errores:');
    results.errors.forEach((e) => {
      console.log(`    - ${e.id}: "${e.name}" → ${e.reason}`);
    });
  }

  if (results.skipped > 0) {
    console.log('');
    console.log('  ℹ️  Los "Skipped" son reglas que requieren revisión manual:');
    console.log('     - SPECIAL_DATE con recurrence="YEARLY" (no tiene equivalente universal)');
    console.log('     - CLIENT sin clientIds ni allClients (datos inválidos en origen)');
    console.log('     - Tipos con conditions vacías o inválidas');
  }

  if (DRY_RUN) {
    console.log('');
    console.log('  ℹ️  Dry-run completado. Para persistir los cambios, ejecutar:');
    console.log('     node scripts/migrate-discount-rules.js --execute');
  }

  console.log('══════════════════════════════════════════════════════════');
  console.log('');
}

main()
  .catch((err) => {
    console.error('Error fatal en migración:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
