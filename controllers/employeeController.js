const employeeServices = require('../services/employeeServices');
const excelService = require('../services/excelService');


const createEmployee = async (req, res) => {
  const dataEmployee = req.body;
  try {
    const result = await employeeServices.create(dataEmployee, req.user);
    res.clearCookie('sudo'); // Limpiar sudo tras éxito
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const getAllEmployees = async (req, res) => {
  
  try {
    const result = await employeeServices.getAll(req.user);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const getEmployeeById = async (req, res) => {
  const { id } = req.params;

  try {
    const result = await employeeServices.getById(id, req.user);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const updateEmployee = async (req, res) => {
  const { id } = req.params;
  const dataEmployee = req.body;
  try {
    const result = await employeeServices.update(id, dataEmployee, req.user);
    res.clearCookie('sudo');
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
}

const toggleActiveStatus = async (req, res) => {
  const { id } = req.params;
  const { isActive } = req.body;

  if (typeof isActive !== "boolean") {
    return res.status(400).json({ message: "Parámetro isActive inválido" });
  }

  try {
    const result = await employeeServices.setActiveStatus(id, isActive, req.user);
    res.clearCookie('sudo'); // Limpiar sudo tras éxito
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
}
const resetPassword = async (req, res) => {
  const { id } = req.params;

  try {
    const result = await employeeServices.resetPassword(id, req.user);
    res.clearCookie('sudo'); // Limpiar sudo tras éxito
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const exportEmployees = async (req, res) => {
  try {
    const employees = await employeeServices.getAll(req.user);
    
    const columns = [
      { header: 'DNI/CUIT', key: 'taxId', width: 15 },
      { header: 'Apellido', key: 'lastName', width: 20 },
      { header: 'Nombre', key: 'firstName', width: 20 },
      { header: 'Email', key: 'email', width: 25 },
      { header: 'Rol', key: 'role', width: 15 },
      { header: 'Teléfono', key: 'phoneNumber', width: 15 },
      { header: 'Estado', key: 'status', width: 15 }
    ];

    const data = employees.map(e => ({
      taxId: e.dni || e.cuit || 'N/A',
      lastName: e.lastName,
      firstName: e.firstName,
      email: e.email || 'N/A',
      role: e.role,
      phoneNumber: e.phoneNumber || 'N/A',
      status: e.isActive ? 'Activo' : 'Baja'
    }));

    await excelService.generateExcel({
      res,
      filename: `empleados_${new Date().toISOString().split('T')[0]}.xlsx`,
      worksheetName: 'Empleados',
      columns,
      data
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = { createEmployee, getAllEmployees, getEmployeeById, updateEmployee, toggleActiveStatus, resetPassword, exportEmployees };
