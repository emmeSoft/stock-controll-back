const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Obtener el historial completo
exports.getAllStockHistory = async (req, res) => {
  try {
    const history = await prisma.stockHistory.findMany({
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
  try {
    const history = await prisma.stockHistory.findMany({
      where: { productId },
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
