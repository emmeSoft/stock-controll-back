const cajaServices = require('../services/cajaServices');
const excelService = require('../services/excelService');

const openRegister = async (req, res) => {
  try {
    const result = await cajaServices.openRegister(req.body, req.user);
    res.status(201).json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const closeRegister = async (req, res) => {
  try {
    const result = await cajaServices.closeRegister(req.body, req.user);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const getCurrentRegister = async (req, res) => {
  try {
    const result = await cajaServices.getCurrentRegister(req.user);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const getRegisterHistory = async (req, res) => {
  try {
    const result = await cajaServices.getRegisterHistory(req.user);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const getGlobalHistory = async (req, res) => {
  try {
    const result = await cajaServices.getGlobalHistory(req.user, req.query);
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getAllRegisters = async (req, res) => {
  try {
    const result = await cajaServices.getAllRegisters(req.user, req.query);
    res.json(result);
  } catch (error) {
    const isLimitError = error.message.includes('máximo');
    res.status(isLimitError ? 400 : 500).json({ 
      message: isLimitError ? error.message : 'Error al obtener el historial de cajas' 
    });
  }
};

const exportRegisters = async (req, res) => {
  try {
    const registers = await cajaServices.getAllRegisters(req.user, req.query);

    const columns = [
      { header: 'Fecha Apertura',      key: 'openedAt',       width: 22 },
      { header: 'Fecha Cierre',        key: 'closedAt',       width: 22 },
      { header: 'Estado',              key: 'status',         width: 12 },
      { header: 'Abierto por',         key: 'openedBy',       width: 25 },
      { header: 'Cerrado por',         key: 'closedBy',       width: 25 },
      { header: 'Base Apertura ($)',   key: 'opening',        width: 18 },
      { header: 'Ventas Efectivo ($)', key: 'efectivo',       width: 20 },
      { header: 'Ventas Transfer ($)', key: 'transferencia',  width: 20 },
      { header: 'Ventas Tarjeta ($)',  key: 'tarjeta',        width: 20 },
      { header: 'Ingresos Man. ($)',   key: 'ingresos',       width: 18 },
      { header: 'Retiros Man. ($)',    key: 'retiros',        width: 18 },
      { header: 'Esperado Sistema ($)',key: 'expected',       width: 20 },
      { header: 'Arqueo Declarado ($)',key: 'closing',        width: 20 },
      { header: 'Diferencia ($)',      key: 'difference',     width: 15 },
      { header: 'Observación',         key: 'observation',    width: 35 },
    ];

    const data = registers.map(reg => {
      const t = reg.totals;
      const fisicoExpected = reg.openingAmount + t.ventasEfectivo + t.ingresosManuales - t.retirosManuales;
      return {
        openedAt:      reg.openedAt,
        closedAt:      reg.closedAt || 'Abierta',
        status:        reg.status === 'CLOSED' ? 'Cerrada' : 'Activa',
        openedBy:      reg.openedByUser ? `${reg.openedByUser.firstName} ${reg.openedByUser.lastName}` : '—',
        closedBy:      reg.closedByUser ? `${reg.closedByUser.firstName} ${reg.closedByUser.lastName}` : '—',
        opening:       reg.openingAmount,
        efectivo:      t.ventasEfectivo,
        transferencia: t.ventasTransferencia,
        tarjeta:       t.ventasTarjeta,
        ingresos:      t.ingresosManuales,
        retiros:       t.retirosManuales,
        expected:      fisicoExpected,
        closing:       reg.closingAmount ?? '—',
        difference:    reg.difference ?? '—',
        observation:   reg.observation || '',
      };
    });

    await excelService.generateExcel({
      res,
      filename: `turnos_${new Date().toISOString().split('T')[0]}.xlsx`,
      worksheetName: 'Turnos y Arqueos',
      columns,
      data,
    });
  } catch (error) {
    console.error('Error exporting registers:', error);
    res.status(500).json({ message: error.message });
  }
};

module.exports = { openRegister, closeRegister, getCurrentRegister, getRegisterHistory, getGlobalHistory, getAllRegisters, exportRegisters };
