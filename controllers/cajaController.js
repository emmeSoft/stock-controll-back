const cajaServices = require('../services/cajaServices');

const openRegister = async (req, res) => {
  try {
    const result = await cajaServices.openRegister(req.body, req.user);
    res.status(201).json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const closeRegister = async (req, res) => {
  try {
    const result = await cajaServices.closeRegister(req.body, req.user);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const getCurrentRegister = async (req, res) => {
  try {
    const result = await cajaServices.getCurrentRegister(req.user);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const getRegisterHistory = async (req, res) => {
  try {
    const result = await cajaServices.getRegisterHistory(req.user);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const getGlobalHistory = async (req, res) => {
  try {
    const result = await cajaServices.getGlobalHistory(req.user, req.query);
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getAllRegisters = async (req, res) => {
  try {
    const result = await cajaServices.getAllRegisters(req.user, req.query);
    res.json(result);
  } catch (error) {
    const statusCode = error.message.includes('máximo') ? 400 : 400;
    res.status(statusCode).json({ message: error.message });
  }
};

module.exports = { openRegister, closeRegister, getCurrentRegister, getRegisterHistory, getGlobalHistory, getAllRegisters };
