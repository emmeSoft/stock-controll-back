const employeeServices = require('../services/employeesServices');


const createEmployee = async (req, res) => {
  const dataEmployee = req.body;

  try {
    const result = await employeeServices.create(dataEmployee);
    res.json(result);
  } catch (error) {
    res.status(401).json({ message: error.message });
  }
};

const getAllEmployees = async (req, res) => {
  try {
    const result = await employeeServices.getAll();
    res.json(result);
  } catch (error) {
    res.status(401).json({ message: error.message });
  }
};

module.exports = { createEmployee, getAllEmployees };
