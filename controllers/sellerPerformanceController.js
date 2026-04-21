const prisma = require('../db/database.prisma');
const excelService = require('../services/excelService');

/**
 * GET /api/seller-performance
 * Query params: from, to (ISO date strings, optional)
 *
 * Returns per-seller sales stats filtered by the active store context.
 */
exports.getSellerPerformance = async (req, res) => {
  try {
    const { from, to } = req.query;
    const { storeId, role, isSistema } = req.user;

    // SISTEMA users MUST have a storeId selected (via context header or specific assignment)
    // to avoid cross-store data collision in performance metrics.
    if (!storeId) {
      const isAdminRole = role === 'SISTEMA' || isSistema;
      if (isAdminRole) {
        return res.status(400).json({ 
          error: 'Debe seleccionar una sucursal para visualizar el desempeño de vendedores.' 
        });
      }
      return res.status(403).json({ error: 'No tiene una sucursal asignada.' });
    }

    const dateFilter = {};
    if (from) dateFilter.gte = new Date(from);
    if (to)   dateFilter.lte = new Date(to);

    const whereClause = {
      status: 'completed',
      ...(storeId && { storeId }),
      ...(Object.keys(dateFilter).length > 0 && { createdAt: dateFilter }),
    };

    const orderAggregates = await prisma.order.groupBy({
      by: ['userId'],
      where: whereClause,
      _count: { id: true },
      _sum:   { amount: true },
    });

    const totalResult = await prisma.order.aggregate({
      where: whereClause,
      _sum:   { amount: true },
      _count: { id: true },
    });
    const grandTotal = totalResult._sum.amount || 0;
    const grandCount = totalResult._count.id   || 0;

    const userIds = orderAggregates.map(a => a.userId).filter(Boolean);
    const users = userIds.length
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
          include: { rbacRole: true },
        })
      : [];

    const usersById = {};
    users.forEach(u => { usersById[u.id] = u; });

    const sellers = orderAggregates.map(agg => {
      const user = usersById[agg.userId];
      const amount = agg._sum.amount || 0;
      return {
        userId:         agg.userId,
        firstName:      user?.firstName     || 'Desconocido',
        lastName:       user?.lastName      || '',
        role:           user?.rbacRole?.name || 'VENDEDOR',
        profilePicture: user?.profilePicture || null,
        salesCount:     agg._count.id,
        totalAmount:    amount,
        percentage:     grandTotal > 0
          ? Math.round((amount / grandTotal) * 10000) / 100
          : 0,
      };
    });

    sellers.sort((a, b) => b.totalAmount - a.totalAmount);

    res.json({
      sellers,
      summary: {
        grandTotal,
        grandCount,
        sellerCount: sellers.length,
      },
    });
  } catch (error) {
    console.error('Error fetching seller performance:', error);
    res.status(500).json({ error: 'Failed to fetch seller performance' });
  }
};

exports.exportPerformance = async (req, res) => {
  try {
    const { from, to } = req.query;
    const { storeId, role, isSistema } = req.user;

    if (!storeId) {
      const isAdminRole = role === 'SISTEMA' || isSistema;
      if (isAdminRole) {
        return res.status(400).json({ 
          error: 'Debe seleccionar una sucursal para exportar el desempeño.' 
        });
      }
      return res.status(403).json({ error: 'No tiene una sucursal asignada.' });
    }

    const dateFilter = {};
    if (from) dateFilter.gte = new Date(from);
    if (to)   dateFilter.lte = new Date(to);

    const whereClause = {
      status: 'completed',
      ...(storeId && { storeId }),
      ...(Object.keys(dateFilter).length > 0 && { createdAt: dateFilter }),
    };

    const orderAggregates = await prisma.order.groupBy({
      by: ['userId'],
      where: whereClause,
      _count: { id: true },
      _sum:   { amount: true },
    });

    const totalResult = await prisma.order.aggregate({
      where: whereClause,
      _sum:   { amount: true },
    });
    const grandTotal = totalResult._sum.amount || 0;

    const userIds = orderAggregates.map(a => a.userId).filter(Boolean);
    const users = userIds.length
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
          include: { rbacRole: true },
        })
      : [];

    const usersById = {};
    users.forEach(u => { usersById[u.id] = u; });

    const sellers = orderAggregates.map(agg => {
      const user = usersById[agg.userId];
      const amount = agg._sum.amount || 0;
      return {
        firstName:      user?.firstName     || 'Desconocido',
        lastName:       user?.lastName      || '',
        role:           user?.rbacRole?.name || 'VENDEDOR',
        salesCount:     agg._count.id,
        totalAmount:    amount,
        percentage:     grandTotal > 0
          ? Math.round((amount / grandTotal) * 10000) / 100
          : 0,
      };
    });

    sellers.sort((a, b) => b.totalAmount - a.totalAmount);

    const columns = [
      { header: 'Vendedor', key: 'name', width: 30 },
      { header: 'Rol', key: 'role', width: 20 },
      { header: 'Cant. Ventas', key: 'salesCount', width: 15 },
      { header: 'Total Recaudado', key: 'totalAmount', width: 20 },
      { header: '% Participación', key: 'percentage', width: 15 }
    ];

    const data = sellers.map(s => ({
      name: `${s.firstName} ${s.lastName}`,
      role: s.role,
      salesCount: s.salesCount,
      totalAmount: s.totalAmount,
      percentage: `${s.percentage}%`
    }));

    await excelService.generateExcel({
      res,
      filename: `desempeño_${new Date().toISOString().split('T')[0]}.xlsx`,
      worksheetName: 'Desempeño',
      columns,
      data
    });
  } catch (error) {
    console.error('Error exporting performance:', error);
    res.status(500).json({ error: 'Failed to export performance' });
  }
};
