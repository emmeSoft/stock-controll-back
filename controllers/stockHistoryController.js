const prisma = require('../db/database.prisma');

const MAX_DAYS = 30;
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
