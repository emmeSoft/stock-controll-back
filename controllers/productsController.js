const productsServices = require('../services/productsServices');


const createProduct = async (req, res) => {
  const dataProduct = req.body;

  if (!dataProduct.categoryId) {
    throw new Error("El producto debe tener una categoría");
  }


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

const updateProduct = async (req, res) => {
  const { id } = req.params;
  const dataProduct = req.body;

  try {
    const result = await productsServices.update(id, dataProduct);
    res.json(result);
  } catch (error) {
    res.status(401).json({ message: error.message });
  }
};

const toggleActiveStatus = async (req, res) => {
  const { id } = req.params;
  const { isActive } = req.body;

  if (typeof isActive !== "boolean") {
    return res.status(400).json({ message: "Parámetro isActive inválido" });
  }

  try {
    const result = await productsServices.setActiveStatus(id, isActive);
    res.json(result);
  } catch (error) {
    res.status(401).json({ message: error.message });
  }
};

module.exports = { createProduct, getAllProducts, getProductById, updateProduct, toggleActiveStatus };
