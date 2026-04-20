/**
 * discountController.js
 */

const discountService = require('../services/discountService');

// GET /api/discounts — listar reglas de la tienda
const getAll = async (req, res) => {
  try {
    const result = await discountService.getAll(req.user.storeId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// GET /api/discounts/:id
const getById = async (req, res) => {
  try {
    const result = await discountService.getById(req.params.id, req.user.storeId);
    res.json(result);
  } catch (error) {
    const status = error.message.includes('no encontrada') ? 404 : 500;
    res.status(status).json({ message: error.message });
  }
};

// POST /api/discounts
const create = async (req, res) => {
  try {
    const result = await discountService.create(req.body, req.user);
    res.status(201).json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// PUT /api/discounts/:id
const update = async (req, res) => {
  try {
    const result = await discountService.update(req.params.id, req.body, req.user);
    res.json(result);
  } catch (error) {
    const status = error.message.includes('no encontrada') ? 404 : 400;
    res.status(status).json({ message: error.message });
  }
};

// PATCH /api/discounts/:id/deactivate — soft delete
const deactivate = async (req, res) => {
  try {
    const result = await discountService.deactivate(req.params.id, req.user);
    res.json({ message: 'Regla desactivada correctamente.', rule: result });
  } catch (error) {
    const status = error.message.includes('no encontrada') ? 404 : 400;
    res.status(status).json({ message: error.message });
  }
};

// PATCH /api/discounts/:id/activate
const activate = async (req, res) => {
  try {
    const result = await discountService.activate(req.params.id, req.user);
    res.json({ message: 'Regla activada correctamente.', rule: result });
  } catch (error) {
    const status = error.message.includes('no encontrada') ? 404 : 500;
    res.status(status).json({ message: error.message });
  }
};

// DELETE /api/discounts/:id — hard delete (solo ADMINISTRADOR y SISTEMA)
const remove = async (req, res) => {
  try {
    const result = await discountService.remove(req.params.id, req.user);
    res.json({ message: 'Regla eliminada físicamente.', deleted: result });
  } catch (error) {
    const status = error.message.includes('no encontrada') ? 404 : 500;
    res.status(status).json({ message: error.message });
  }
};

// POST /api/discounts/preview
const preview = async (req, res) => {
  try {
    const result = await discountService.preview(req.user.storeId, req.body);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

module.exports = { getAll, getById, create, update, deactivate, activate, remove, preview };
