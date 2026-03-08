const clientServices = require('../services/clientServices');


const createClient = async (req, res) => {
  const dataClient = req.body;

  try {
    const result = await clientServices.create(dataClient, req.user);
    res.json(result);
  } catch (error) {
    res.status(401).json({ message: error.message });
  }
};

const getAllClients = async (req, res) => {
  try {
    const result = await clientServices.getAll(req.user);
    res.json(result);
  } catch (error) {
    res.status(401).json({ message: error.message });
  }
};
const getClientDetails = async (req, res) => {
  const { id } = req.params;

  try {
    const result = await clientServices.getById(id, req.user);
    res.json(result);
  } catch (error) {
    res.status(401).json({ message: error.message });
  }
};

const updateClient = async (req, res) => {
  const { id } = req.params;
  const dataClient = req.body;
  try {
    const result = await clientServices.update(id, dataClient, req.user);
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
    const result = await clientServices.setActiveStatus(id, isActive, req.user);
    res.json(result);
  } catch (error) {
    res.status(401).json({ message: error.message });
  }
};



module.exports = { createClient, getAllClients, getClientDetails, updateClient, toggleActiveStatus };
