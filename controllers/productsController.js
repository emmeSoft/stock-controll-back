const productsServices = require('../services/productsServices');


const createProduct = async (req, res) => {
  const dataProduct = req.body;

  try {
    const result = await productsServices.create(dataProduct);
    res.json(result);
  } catch (error) {
    res.status(401).json({ message: error.message });
  }
};

const getAllProducts = async (req, res) => {
  try {
    const result = await productsServices.getAll();
    res.json(result);
  } catch (error) {
    res.status(401).json({ message: error.message });
  }
};

const getProductById = async (req, res) => {
  const { id } = req.params;

  try {
    const result = await productsServices.getById(id);
    res.json(result);
  } catch (error) {
    res.status(401).json({ message: error.message });
  }
};

module.exports = { createProduct, getAllProducts, getProductById };
