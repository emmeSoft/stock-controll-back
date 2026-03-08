
const suppliersServices = require('../services/suppliersServices');


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

module.exports = { createSuppliers, getAllSuppliers, getSupplierById, updateSuppliers, toggleActiveStatus };
