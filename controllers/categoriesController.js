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

module.exports = { createCategories, getAllCategories };
