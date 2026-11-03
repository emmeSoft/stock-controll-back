const movimientosServices = require('../services/movimientosServices');
const excelService = require('../services/excelService');
const prisma = require('../db/database.prisma');
const { toNumber } = require('../utils/money');

const createMovement = async (req, res) => {
  try {
    const result = await movimientosServices.createMovement(req.body, req.user);
    res.status(201).json(result);
  } catch (error) {
    // caja-close-integrity: `code` is additive and gated on `error.status`
    // so Prisma's own `.code` never leaks into the response body.
    const code = error.status ? error.code : undefined;
    res.status(error.status || 400).json({ message: error.message, ...(code && { code }) });
  }
};

const getMovements = async (req, res) => {
  const { registerId } = req.params;
  try {
    const result = await movimientosServices.getMovementsByRegister(registerId, req.user);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const exportMovements = async (req, res) => {
  try {
    const { storeId } = req.user;
    const { from, to } = req.query;

    const dateFilter = {};
    if (from) dateFilter.gte = new Date(from);
    if (to)   dateFilter.lte = new Date(to);

    const movements = await prisma.cashMovement.findMany({
      where: {
        storeId,
        ...(Object.keys(dateFilter).length > 0 && { createdAt: dateFilter })
      },
      include: {
        user: true,
        cashRegister: true
      },
      orderBy: { createdAt: 'desc' }
    });

    const columns = [
      { header: 'Fecha', key: 'date', width: 20 },
      { header: 'Tipo', key: 'type', width: 15 },
      { header: 'Monto', key: 'amount', width: 15 },
      { header: 'Descripción', key: 'desc', width: 35 },
      { header: 'Referencia', key: 'ref', width: 20 },
      { header: 'Caja ID', key: 'register', width: 15 },
      { header: 'Usuario', key: 'user', width: 25 }
    ];

    const data = movements.map(m => ({
      date: m.createdAt,
      type: m.type === 'INCOME' ? 'Ingreso' : 'Egreso',
      // money-stock-integrity: m.amount is still Decimal — Excel export
      // bypasses the res.json serializer, so unwrap it explicitly.
      amount: toNumber(m.amount),
      desc: m.description,
      ref: m.reference,
      register: m.cashRegisterId.slice(-6).toUpperCase(),
      user: m.user ? `${m.user.firstName} ${m.user.lastName}` : 'N/A'
    }));

    await excelService.generateExcel({
      res,
      filename: `movimientos_${new Date().toISOString().split('T')[0]}.xlsx`,
      worksheetName: 'Movimientos',
      columns,
      data
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = { createMovement, getMovements, exportMovements };
