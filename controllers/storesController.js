const storesServices = require('../services/storesServices');

const createStore = async (req, res) => {
  try {
    const result = await storesServices.create(req.body, req.user);
    res.status(201).json(result);
  } catch (error) {
    res.status(403).json({ message: error.message });
  }
};

const getAllStores = async (req, res) => {
  try {
    const result = await storesServices.getAll(req.user);
    res.json(result);
  } catch (error) {
    res.status(401).json({ message: error.message });
  }
};

const getStoreById = async (req, res) => {
  const { id } = req.params;
  try {
    const result = await storesServices.getById(id, req.user);
    res.json(result);
  } catch (error) {
    res.status(403).json({ message: error.message });
  }
};

const updateStore = async (req, res) => {
  const { id } = req.params;
  try {
    const result = await storesServices.update(id, req.body, req.user);
    res.json(result);
  } catch (error) {
    res.status(403).json({ message: error.message });
  }
};

const toggleActiveStatus = async (req, res) => {
  const { id } = req.params;
  const { isActive } = req.body;

  if (typeof isActive !== "boolean") {
    return res.status(400).json({ message: "Parámetro isActive inválido" });
  }

  try {
    const result = await storesServices.setActiveStatus(id, isActive, req.user);
    res.json(result);
  } catch (error) {
    res.status(403).json({ message: error.message });
  }
};

module.exports = { createStore, getAllStores, getStoreById, updateStore, toggleActiveStatus };
