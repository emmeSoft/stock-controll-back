const employeeServices = require('../services/employeeServices');


const createEmployee = async (req, res) => {
  const dataEmployee = req.body;
console.log('Datos recibidos para nuevo empleado:', dataEmployee);
  try {
    const result = await employeeServices.create(dataEmployee, req.user);
    res.json(result);
  } catch (error) {
    res.status(401).json({ message: error.message });
  }
};

const getAllEmployees = async (req, res) => {
  
  try {
    const result = await employeeServices.getAll(req.user);
    res.json(result);
    console.log('Empleados Cargados:', result);
  } catch (error) {
    res.status(401).json({ message: error.message });
  }
};

const getEmployeeById = async (req, res) => {
  const { id } = req.params;

  try {
    const result = await employeeServices.getById(id, req.user);
    res.json(result);
  } catch (error) {
    res.status(401).json({ message: error.message });
  }
};

const updateEmployee = async (req, res) => {
  const { id } = req.params;
  const dataEmployee = req.body;
  try {
    const result = await employeeServices.update(id, dataEmployee, req.user);
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
    const result = await employeeServices.setActiveStatus(id, isActive, req.user);
    res.json(result);
  } catch (error) {
    res.status(401).json({ message: error.message });
  }
}

module.exports = { createEmployee, getAllEmployees, getEmployeeById, updateEmployee, toggleActiveStatus };
