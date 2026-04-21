const clientServices = require('../services/clientServices');
const excelService = require('../services/excelService');


const createClient = async (req, res) => {
  const dataClient = req.body;

  try {
    const result = await clientServices.create(dataClient, req.user);
    res.json(result);
  } catch (error) {
    res.status(401).json({ message: error.message });
  }
};

const getAllClients = async (req, res) => {
  try {
    const result = await clientServices.getAll(req.user);
    res.json(result);
  } catch (error) {
    res.status(401).json({ message: error.message });
  }
};
const getClientDetails = async (req, res) => {
  const { id } = req.params;

  try {
    const result = await clientServices.getById(id, req.user);
    res.json(result);
  } catch (error) {
    res.status(401).json({ message: error.message });
  }
};

const updateClient = async (req, res) => {
  const { id } = req.params;
  const dataClient = req.body;
  try {
    const result = await clientServices.update(id, dataClient, req.user);
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
    const result = await clientServices.setActiveStatus(id, isActive, req.user);
    res.json(result);
  } catch (error) {
    res.status(401).json({ message: error.message });
  }
};

const exportClients = async (req, res) => {
  try {
    const clients = await clientServices.getAll(req.user);
    
    const columns = [
      { header: 'DNI/CUIT', key: 'taxId', width: 15 },
      { header: 'Apellido', key: 'lastName', width: 20 },
      { header: 'Nombre', key: 'firstName', width: 20 },
      { header: 'Email', key: 'email', width: 25 },
      { header: 'Teléfono', key: 'phoneNumber', width: 15 },
      { header: 'Estado', key: 'status', width: 15 }
    ];

    const data = clients.map(c => ({
      taxId: c.dni || c.cuit || 'N/A',
      lastName: c.lastName,
      firstName: c.firstName,
      email: c.email || 'N/A',
      phoneNumber: c.phoneNumber || 'N/A',
      status: c.isActive ? 'Activo' : 'Baja'
    }));

    await excelService.generateExcel({
      res,
      filename: `clientes_${new Date().toISOString().split('T')[0]}.xlsx`,
      worksheetName: 'Clientes',
      columns,
      data
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = { createClient, getAllClients, getClientDetails, updateClient, toggleActiveStatus, exportClients };
