
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
const getClientDetails = async (req, res) => {
  const { id } = req.params;

  try {
    const result = await clientServices.getById(id);
    res.json(result);
  } catch (error) {
    res.status(401).json({ message: error.message });
  }
};

const updateClient = async (req, res) => {
  const { id } = req.params;
  const dataClient = req.body;
  try {
    const result = await clientServices.update(id, dataClient);
    res.json(result);
  } catch (error) {
    res.status(401).json({ message: error.message });
  }
}

const disableClient = async (req, res) => {
  const { id } = req.params;
  
  try {
    const result = await clientServices.disable(id);
    res.json(result);
  } catch (error) {
    res.status(401).json({ message: error.message });
  }
};

const enableClient = async (req, res) => {
  const { id } = req.params;
  try {
    const result = await clientServices.enable(id);
    res.json(result);
  } catch (error) {
    res.status(401).json({ message: error.message });
  }
};

// const disableClient = async (req, res) => { const { id } = req.params; try { const result = await clientServices.disable(id); res.json(result); } catch (error) { res.status(401).json({ message: error.message }); } }

module.exports = { createClient, getAllClients, getClientDetails, updateClient, disableClient, enableClient };
