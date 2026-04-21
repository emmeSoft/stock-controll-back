const prisma = require('../db/database.prisma');
const excelService = require('../services/excelService');

const MAX_DAYS = 30;

exports.exportStockHistory = async (req, res) => {
  try {
    const { storeId } = req.user || {};
    const { startDate, endDate } = req.query;

    const range = buildDateRange(startDate, endDate);
    if (range.error) return res.status(400).json({ error: range.error });

    const whereClause = {
      ...(storeId ? { storeId } : {}),
      createdAt: { gte: range.start, lte: range.end },
    };

    const history = await prisma.stockHistory.findMany({
      where: whereClause,
      include: {
        product: true,
        user: true,
        store: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    const columns = [
      { header: 'Fecha', key: 'date', width: 20 },
      { header: 'Producto', key: 'product', width: 30 },
      { header: 'SKU', key: 'sku', width: 15 },
      { header: 'Tipo', key: 'type', width: 15 },
      { header: 'Cantidad', key: 'amount', width: 10 },
      { header: 'Stock Previo', key: 'prev', width: 12 },
      { header: 'Stock Actual', key: 'curr', width: 12 },
      { header: 'Responsable', key: 'user', width: 25 },
      { header: 'Descripción', key: 'desc', width: 35 }
    ];

    const data = history.map(h => ({
      date: h.createdAt,
      product: h.product ? h.product.name : 'Producto Eliminado',
      sku: h.product ? (h.product.sku || 'N/A') : 'N/A',
      type: h.type,
      amount: h.movementAmount,
      prev: h.previousStock,
      curr: h.currentStock,
      user: h.user ? `${h.user.firstName} ${h.user.lastName}` : 'Sistema',
      desc: h.description
    }));

    await excelService.generateExcel({
      res,
      filename: `historial_stock_${new Date().toISOString().split('T')[0]}.xlsx`,
      worksheetName: 'Historial Stock',
      columns,
      data
    });
  } catch (error) {
    console.error('Error exporting stock history:', error);
    res.status(500).json({ error: 'Failed to export stock history' });
  }
};
const DEFAULT_DAYS = 7;

function buildDateRange(startDate, endDate) {
  const now = new Date();

  let start, end;

  if (startDate) {
    // If startDate comes as 'YYYY-MM-DD', we force it to local start of day
    start = new Date(`${startDate}T00:00:00`);
  } else {
    start = new Date(now);
    start.setDate(start.getDate() - DEFAULT_DAYS);
    start.setHours(0, 0, 0, 0);
  }

  if (endDate) {
    // If endDate comes as 'YYYY-MM-DD', we force it to local end of day
    end = new Date(`${endDate}T23:59:59.999`);
  } else {
    end = new Date(now);
    end.setHours(23, 59, 59, 999);
  }

  // Enforce maximum period
  const diffDays = (end - start) / (1000 * 60 * 60 * 24);
  if (diffDays > MAX_DAYS) {
    return { error: `El período máximo permitido es de ${MAX_DAYS} días.` };
  }

  return { start, end };
}

// Obtener el historial completo
exports.getAllStockHistory = async (req, res) => {
  try {
    const { storeId } = req.user || {};
    const { startDate, endDate } = req.query;

    const range = buildDateRange(startDate, endDate);
    if (range.error) return res.status(400).json({ error: range.error });

    const whereClause = {
      ...(storeId ? { storeId } : {}),
      createdAt: { gte: range.start, lte: range.end },
    };

    const history = await prisma.stockHistory.findMany({
      where: whereClause,
      include: {
        product: true,
        user: true,
        store: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
    res.json(history);
  } catch (error) {
    console.error('Error fetching stock history:', error);
    res.status(500).json({ error: 'Failed to fetch stock history' });
  }
};

// Obtener el historial de un producto específico
exports.getProductStockHistory = async (req, res) => {
  const { productId } = req.params;
  const { startDate, endDate } = req.query;

  try {
    const { storeId } = req.user || {};

    const range = buildDateRange(startDate, endDate);
    if (range.error) return res.status(400).json({ error: range.error });

    const whereClause = { 
      productId, 
      ...(storeId && { storeId }),
      createdAt: { gte: range.start, lte: range.end },
    };

    const history = await prisma.stockHistory.findMany({
      where: whereClause,
      include: {
        product: true,
        user: true,
        store: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
    res.json(history);
  } catch (error) {
    console.error('Error fetching product stock history:', error);
    res.status(500).json({ error: 'Failed to fetch product stock history' });
  }
};
