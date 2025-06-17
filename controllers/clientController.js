
const clientServices = require('../services/clientServices');


const createClient = async (req, res) => {
  const dataClient = req.body;

  try {
    const result = await clientServices.create(dataClient);
    res.json(result);
  } catch (error) {
    res.status(401).json({ message: error.message });
  }
};

const getAllClients = async (req, res) => {
  try {
    const result = await clientServices.getAll();
    res.json(result);
  } catch (error) {
    res.status(401).json({ message: error.message });
  }
};

module.exports = { createClient, getAllClients };
