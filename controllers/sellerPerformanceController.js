const prisma = require('../db/database.prisma');

/**
 * GET /api/seller-performance
 * Query params: from, to (ISO date strings, optional)
 *
 * Returns per-seller sales stats filtered by the active store context.
 * - For SUPERADMIN viewing "ALL" stores: req.user.storeId is undefined → no filter.
 * - For SUPERADMIN with a specific store selected (x-store-id header): req.user.storeId is set.
 * - For ADMIN/USUARIO: req.user.storeId is always their assigned store.
 */
exports.getSellerPerformance = async (req, res) => {
  try {
    const { from, to } = req.query;
    const { storeId } = req.user; // set by authMiddleware (respects x-store-id for SUPERADMIN)

    // Build date filter
    const dateFilter = {};
    if (from) dateFilter.gte = new Date(from);
    if (to)   dateFilter.lte = new Date(to);

    const whereClause = {
      status: 'completed',
      ...(storeId && { storeId }),
      ...(Object.keys(dateFilter).length > 0 && { createdAt: dateFilter }),
    };

    // Aggregate orders grouped by userId
    const orderAggregates = await prisma.order.groupBy({
      by: ['userId'],
      where: whereClause,
      _count: { id: true },
      _sum:   { amount: true },
    });

    // Total amount across all sellers for this period (to compute %)
    const totalResult = await prisma.order.aggregate({
      where: whereClause,
      _sum:   { amount: true },
      _count: { id: true },
    });
    const grandTotal = totalResult._sum.amount || 0;
    const grandCount = totalResult._count.id   || 0;

    // Collect unique userIds (excluding null = system / auto)
    const userIds = orderAggregates
      .map(a => a.userId)
      .filter(Boolean);

    // Fetch user details
    const users = userIds.length
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, firstName: true, lastName: true, role: true, profilePicture: true },
        })
      : [];

    const usersById = {};
    users.forEach(u => { usersById[u.id] = u; });

    // Build response rows
    const sellers = orderAggregates.map(agg => {
      const user = usersById[agg.userId];
      const amount = agg._sum.amount || 0;
      return {
        userId:         agg.userId,
        firstName:      user?.firstName     || 'Desconocido',
        lastName:       user?.lastName      || '',
        role:           user?.role          || 'USUARIO',
        profilePicture: user?.profilePicture || null,
        salesCount:     agg._count.id,
        totalAmount:    amount,
        percentage:     grandTotal > 0
          ? Math.round((amount / grandTotal) * 10000) / 100
          : 0,
      };
    });

    // Sort by totalAmount desc
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
