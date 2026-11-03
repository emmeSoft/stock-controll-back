const salesServices = require('../services/salesServices');
const excelService = require('../services/excelService');
const { toNumber } = require('../utils/money');

const createSale = async (req, res) => {
  try {
    const saleData = req.body;
    // saleData should contain { items: [{ id: productId, quantity, price }], amount: totalAmount, clientId: optional }

    if (!saleData.items || saleData.items.length === 0) {
      return res.status(400).json({ message: "La venta debe tener al menos un producto" });
    }

    const result = await salesServices.create(saleData, req.user);
    res.status(201).json(result);
  } catch (error) {
    // El guard atómico de stock (PASO 10 de salesServices.create) lanza
    // { status: 409 } cuando otra venta concurrente se llevó el stock
    // primero — sin este fallback, SIEMPRE se devolvía 400 sin importar el
    // status real del error, y el 409 nunca llegaba al POS.
    // caja-close-integrity: `code` is additive and gated on `error.status`
    // so Prisma's own `.code` never leaks into the response body.
    const code = error.status ? error.code : undefined;
    res.status(error.status || 400).json({ message: error.message, ...(code && { code }) });
  }
};

const getAllSales = async (req, res) => {
  try {
    const result = await salesServices.getAll(req.user);
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getSaleById = async (req, res) => {
  try {
    const result = await salesServices.getById(req.params.id, req.user);
    res.json(result);
  } catch (error) {
    if (error.message.includes('no encontrada')) {
        res.status(404).json({ message: error.message });
    } else {
        res.status(500).json({ message: error.message });
    }
  }
};

const exportSales = async (req, res) => {
  try {
    const sales = await salesServices.getAll(req.user);
    
    const columns = [
      { header: 'ID', key: 'id', width: 15 },
      { header: 'Fecha', key: 'date', width: 20 },
      { header: 'Cliente', key: 'client', width: 25 },
      { header: 'Vendedor', key: 'user', width: 25 },
      { header: 'Subtotal', key: 'subtotal', width: 15 },
      { header: 'Descuento', key: 'discount', width: 15 },
      { header: 'Total', key: 'amount', width: 15 },
      { header: 'Medodo de Pago', key: 'paymentMethod', width: 15 },
      { header: 'Estado', key: 'status', width: 15 }
    ];

    const data = sales.map(sale => ({
      id: sale.id.slice(-6).toUpperCase(),
      date: sale.createdAt,
      client: sale.client ? `${sale.client.firstName} ${sale.client.lastName}` : 'Consumidor Final',
      user: sale.user ? `${sale.user.firstName} ${sale.user.lastName}` : 'Sistema',
      // money-stock-integrity: sale.amount/discountTotal are still
      // Prisma.Decimal here (this handler streams via excelService, which
      // bypasses the res.json Decimal->Number serializer). Native `+` on
      // two Decimal objects string-concatenates instead of adding — wrap
      // every money value with toNumber() before building the Excel row.
      subtotal: toNumber(sale.amount) + toNumber(sale.discountTotal),
      discount: toNumber(sale.discountTotal),
      amount: toNumber(sale.amount),
      paymentMethod: sale.paymentMethod,
      status: sale.status
    }));

    await excelService.generateExcel({
      res,
      filename: `ventas_${new Date().toISOString().split('T')[0]}.xlsx`,
      worksheetName: 'Ventas',
      columns,
      data
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};


const cancelSale = async (req, res) => {
  try {
    const { id } = req.params;
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({ message: 'Se requiere la contraseña para confirmar la anulación.' });
    }

    const result = await salesServices.cancel(id, password, req.user);
    res.json({ message: 'Venta anulada correctamente.', order: result });
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json({ message: error.message });
  }
};

module.exports = { createSale, getAllSales, getSaleById, exportSales, cancelSale };

