/**
 * excel-export.test.js — Tests del boundary de dinero en exportaciones Excel
 * ─────────────────────────────────────────────────────────────────
 * `excelService.generateExcel` se llama con `{ res, ... }` y hace streaming
 * directo a la respuesta HTTP — nunca pasa por `res.json`, así que el
 * interceptor global `middlewares/decimalSerializer.js` (Unit 2) nunca lo
 * alcanza. Los 5 controllers que exportan dinero a Excel (salesController,
 * movimientosController, cajaController, productsController,
 * sellerPerformanceController) deben envolver cada valor monetario con
 * `money.toNumber()` antes de escribirlo en la fila, o de lo contrario:
 *   - Un `Prisma.Decimal` crudo escrito directo en una celda no es
 *     `typeof 'number'`, así que ExcelJS no lo trata como celda numérica.
 *   - Aritmética nativa (`+`, `-`) entre dos Decimal hace *string
 *     concatenation* en vez de sumar/restar (demostrado en CASO 2).
 *
 * Este test NO re-implementa cada uno de los 5 controllers (su lógica de
 * mapeo está inline, no es una función exportada separable). En cambio:
 *   CASO 1: ejercita el motor real (`excelService.generateExcel`, con el
 *   mismo `exceljs` que usa en producción) end-to-end — genera un buffer
 *   .xlsx real, lo relee con `ExcelJS.Workbook#xlsx.load`, e inspecciona el
 *   `typeof` de las celdas de dinero ya corregidas (replica el patrón de
 *   `salesController.exportSales`: `toNumber(amount) + toNumber(discountTotal)`).
 *   CASO 2: aísla el bug de raíz (string concat nativo sobre dos Decimal)
 *   para probar que el test ejercita algo real y no es vacuously true.
 *
 * Verificación manual adicional (no cubierta por este test, documentada en
 * el reporte de apply): se confirmó visualmente que las 5 celdas de dinero
 * fijadas (subtotal/discount/amount en ventas, amount en movimientos,
 * price en productos, totalAmount en desempeño, y las 8 celdas de
 * cajaController incluyendo el cálculo `fisicoExpected`) ya no son
 * `Prisma.Decimal` crudo en el momento en que se construye `data`, leyendo
 * el diff de cada controller.
 *
 * Ejecutar con: node tests/money/excel-export.test.js
 * ─────────────────────────────────────────────────────────────────
 */

const { Writable } = require('stream');
const { Prisma } = require('@prisma/client');
const ExcelJS = require('exceljs');
const excelService = require('../../services/excelService');
const { toNumber } = require('../../utils/money');

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FALLO: ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`✅ ${message}`);
  }
}

// Fake Express response: a writable stream (what `workbook.xlsx.write(res)`
// needs) that buffers every chunk in memory, plus the two no-op methods
// `generateExcel` calls before streaming (`setHeader`, `end`).
function createBufferingRes() {
  const chunks = [];
  const res = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(chunk);
      cb();
    },
  });
  res.setHeader = () => {};
  res.getBuffer = () => Buffer.concat(chunks);
  return res;
}

async function main() {
  // ═══════════════════════════════════════════════════════════════
  // CASO 1: excelService.generateExcel produce celdas numéricas reales
  // para dinero construido con toNumber(), no strings.
  // ═══════════════════════════════════════════════════════════════
  console.log('\n--- CASO 1: celdas de dinero son number, no string concat ---');

  {
    // Fixture equivalente a `sale` en salesController.exportSales: campos
    // de dinero todavía Prisma.Decimal (como vienen de la DB, antes del
    // boundary).
    const sale = {
      amount: new Prisma.Decimal('1500.00'),
      discountTotal: new Prisma.Decimal('200.50'),
    };

    // Replica exacta del fix en salesController.js: toNumber() antes de
    // sumar y antes de escribir en la fila.
    const data = [
      {
        id: 'ABC123',
        subtotal: toNumber(sale.amount) + toNumber(sale.discountTotal),
        discount: toNumber(sale.discountTotal),
        amount: toNumber(sale.amount),
      },
    ];

    const res = createBufferingRes();
    await excelService.generateExcel({
      res,
      filename: 'test.xlsx',
      worksheetName: 'Test',
      columns: [
        { header: 'ID', key: 'id', width: 10 },
        { header: 'Subtotal', key: 'subtotal', width: 10 },
        { header: 'Descuento', key: 'discount', width: 10 },
        { header: 'Total', key: 'amount', width: 10 },
      ],
      data,
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(res.getBuffer());
    const worksheet = workbook.getWorksheet('Test');
    const dataRow = worksheet.getRow(2); // row 1 is the header

    const subtotalCell = dataRow.getCell(2);
    const discountCell = dataRow.getCell(3);
    const amountCell = dataRow.getCell(4);

    assert(
      typeof subtotalCell.value === 'number',
      `subtotal cell is typeof number (visto: ${typeof subtotalCell.value}, valor: ${JSON.stringify(subtotalCell.value)})`
    );
    assert(
      subtotalCell.value === 1700.5,
      `subtotal cell equals toNumber(amount)+toNumber(discountTotal) = 1700.5, not string-concatenated "1500200.5" (visto: ${subtotalCell.value})`
    );
    assert(typeof discountCell.value === 'number', 'discount cell is typeof number');
    assert(discountCell.value === 200.5, 'discount cell equals 200.5');
    assert(typeof amountCell.value === 'number', 'amount cell is typeof number');
    assert(amountCell.value === 1500, 'amount cell equals 1500');
  }

  // ═══════════════════════════════════════════════════════════════
  // CASO 2: sanity check — prueba que el bug de raíz es real (y por lo
  // tanto que CASO 1 ejercita algo genuino, no un test vacuo). Nativo `+`
  // sobre dos Prisma.Decimal hace string concatenation, no suma.
  // ═══════════════════════════════════════════════════════════════
  console.log('\n--- CASO 2: sanity check del bug de raíz (sin el fix) ---');

  {
    const amount = new Prisma.Decimal('1500.00');
    const discountTotal = new Prisma.Decimal('200.50');
    // eslint-disable-next-line no-restricted-syntax -- intencional: este es
    // exactamente el bug que el fix evita, aislado para probar que existe.
    const buggySubtotal = amount + discountTotal;

    assert(
      typeof buggySubtotal === 'string',
      `sin toNumber(), native + sobre dos Prisma.Decimal hace string concat, no suma (visto: typeof ${typeof buggySubtotal}, valor: "${buggySubtotal}")`
    );
    assert(
      buggySubtotal !== '1700.5',
      `confirma que el valor concatenado ("${buggySubtotal}") difiere del resultado correcto (1700.5) — si esto alguna vez fuera igual, ya no demostraría el bug`
    );
  }

  if (process.exitCode === 1) {
    console.error('\n❌ Algunas aserciones de excel-export.test.js fallaron.');
    process.exit(1);
  }
  console.log('\n✅ Todos los tests de excel-export.test.js pasaron.');
}

if (require.main === module) {
  main().catch((err) => {
    console.error('❌ FALLO INESPERADO en excel-export.test.js:', err.message);
    process.exit(1);
  });
}

// Exportado para que tests/run-all.js pueda `await` este test (hace I/O
// async real vía workbook.xlsx.write/load).
module.exports = main;
