const categoriesServices = require('../services/categoriesServices');


const createCategories = async (req, res) => {
  const dataCategories = req.body;

  try {
    const result = await categoriesServices.create(dataCategories);
    res.json(result);
  } catch (error) {
    res.status(401).json({ message: error.message });
  }
};

const getAllCategories = async (req, res) => {
  try {
    const result = await categoriesServices.getAll();
    res.json(result);
  } catch (error) {
    res.status(401).json({ message: error.message });
  }
};

const getCategoryById = async (req, res) => {
  const { id } = req.params;  

  try {
    const result = await categoriesServices.getById(id);
    res.json(result);
  } catch (error) {
    res.status(401).json({ message: error.message });
  }
};

const updateCategories = async (req, res) => {
  const { id } = req.params;
  const dataCategories = req.body;

  try {
    const result = await categoriesServices.update(id, dataCategories);
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
    const result = await categoriesServices.setActiveStatus(id, isActive);
    res.json(result);
  } catch (error) {
    res.status(401).json({ message: error.message });
  }
};

module.exports = { createCategories, getAllCategories, getCategoryById, updateCategories, toggleActiveStatus };
