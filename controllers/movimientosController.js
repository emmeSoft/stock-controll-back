const movimientosServices = require('../services/movimientosServices');

const createMovement = async (req, res) => {
  try {
    const result = await movimientosServices.createMovement(req.body, req.user);
    res.status(201).json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const getMovements = async (req, res) => {
  const { registerId } = req.params;
  try {
    const result = await movimientosServices.getMovementsByRegister(registerId, req.user);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

module.exports = { createMovement, getMovements };
