const suppliersServices = require('../services/suppliersServices');
const excelService = require('../services/excelService');


const createSuppliers = async (req, res) => {
  const dataSuppliers = req.body;

  try {
    const result = await suppliersServices.create(dataSuppliers, req.user);
    res.json(result);
  } catch (error) {
    res.status(401).json({ message: error.message });
  }
};

const getAllSuppliers = async (req, res) => {
  try {
    const result = await suppliersServices.getAll(req.user);
    res.json(result);
  } catch (error) {
    res.status(401).json({ message: error.message });
  }
};

const getSupplierById = async (req, res) => {
  const { id } = req.params;

  try {
    const result = await suppliersServices.getById(id, req.user);
    res.json(result);
  } catch (error) {
    res.status(401).json({ message: error.message }); 
  }

}

const updateSuppliers = async (req, res) => {
  const { id } = req.params;
  const dataSuppliers = req.body;

  try {
    const result = await suppliersServices.update(id, dataSuppliers, req.user);
    res.json(result);
  } catch (error) {
    res.status(401).json({ message: error.message });
  }
}

const toggleActiveStatus = async (req, res) => {
  const { id } = req.params;
  const { isActive } = req.body;

  if (typeof isActive !== "boolean") {
    return res.status(400).json({ message: "Parámetro isActive inválido" });
  }

  try {
    const result = await suppliersServices.setActiveStatus(id, isActive, req.user);
    res.json(result);
  } catch (error) {
    res.status(401).json({ message: error.message });
  }
};

const exportSuppliers = async (req, res) => {
  try {
    const suppliers = await suppliersServices.getAll(req.user);
    
    const columns = [
      { header: 'CUIT', key: 'taxId', width: 15 },
      { header: 'Nombre/Razón Social', key: 'fullName', width: 30 },
      { header: 'Email', key: 'email', width: 25 },
      { header: 'Teléfono', key: 'phoneNumber', width: 15 },
      { header: 'Estado', key: 'status', width: 15 }
    ];

    const data = suppliers.map(s => ({
      taxId: s.cuit || 'N/A',
      fullName: s.fullName,
      email: s.email || 'N/A',
      phoneNumber: s.phoneNumber || 'N/A',
      status: s.isActive ? 'Activo' : 'Baja'
    }));

    await excelService.generateExcel({
      res,
      filename: `proveedores_${new Date().toISOString().split('T')[0]}.xlsx`,
      worksheetName: 'Proveedores',
      columns,
      data
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = { createSuppliers, getAllSuppliers, getSupplierById, updateSuppliers, toggleActiveStatus, exportSuppliers };
