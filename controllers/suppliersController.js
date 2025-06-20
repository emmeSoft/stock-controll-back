
const suppliersServices = require('../services/suppliersServices');


const createSuppliers = async (req, res) => {
  const dataSuppliers = req.body;

  try {
    const result = await suppliersServices.create(dataSuppliers);
    res.json(result);
  } catch (error) {
    res.status(401).json({ message: error.message });
  }
};

const getAllSuppliers = async (req, res) => {
  try {
    const result = await suppliersServices.getAll();
    res.json(result);
  } catch (error) {
    res.status(401).json({ message: error.message });
  }
};

const getSupplierById = async (req, res) => {
  const { id } = req.params;

  try {
    const result = await suppliersServices.getById(id);
    res.json(result);
  } catch (error) {
    res.status(401).json({ message: error.message }); 
  }

}

module.exports = { createSuppliers, getAllSuppliers, getSupplierById   };
