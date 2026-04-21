const ExcelJS = require('exceljs');

/**
 * Generates and streams an Excel file to the response.
 * 
 * @param {Object} options
 * @param {import('express').Response} options.res - Express response object
 * @param {string} options.filename - Name of the file (e.g. 'ventas.xlsx')
 * @param {string} options.worksheetName - Name of the sheet
 * @param {Array} options.columns - Array of { header: string, key: string, width: number }
 * @param {Array} options.data - Array of data objects
 */
async function generateExcel({ res, filename, worksheetName, columns, data }) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(worksheetName);

  // Set columns
  worksheet.columns = columns.map(col => ({
    header: col.header,
    key: col.key,
    width: col.width || 20
  }));

  // Style the header row
  const headerRow = worksheet.getRow(1);
  headerRow.font = { name: 'Arial', family: 4, size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF0047AB' } // Premium Blue
  };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };

  // Add data rows
  worksheet.addRows(data);

  // Style and sanitize all data rows
  worksheet.eachRow((row, rowNumber) => {
    row.eachCell((cell) => {
      // 1. Security: Escape Excel Formula Injection (=, +, -, @)
      // Only for string values to avoid corrupting Numbers, Dates or Booleans
      if (typeof cell.value === 'string' && /^[=+\-@\s]/.test(cell.value)) {
        cell.value = `'${cell.value}`;
      }

      // 2. Styling
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      };
      
      // Auto-formatting for dates
      if (cell.value instanceof Date) {
        cell.numFmt = 'dd/mm/yyyy hh:mm';
      }
      
      // Alignment for numbers
      if (typeof cell.value === 'number') {
        cell.alignment = { horizontal: 'right' };
      }
    });

    if (rowNumber > 1) {
      row.font = { name: 'Arial', size: 10 };
    }
  });

  // Set response headers
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader(
    'Content-Disposition',
    `attachment; filename=${filename}`
  );

  // Stream the workbook to the response
  await workbook.xlsx.write(res);
  res.end();
}

module.exports = { generateExcel };
