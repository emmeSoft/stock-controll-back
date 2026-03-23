const salesServices = require('../services/salesServices');

const createSale = async (req, res) => {
  try {
    const saleData = req.body;
    // saleData should contain { items: [{ id: productId, quantity, price }], amount: totalAmount, clientId: optional }

    if (!saleData.items || saleData.items.length === 0) {
      return res.status(400).json({ message: "La venta debe tener al menos un producto" });
    }

    const result = await salesServices.create(saleData, req.user);
    res.status(201).json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const getAllSales = async (req, res) => {
  try {
    const result = await salesServices.getAll(req.user);
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getSaleById = async (req, res) => {
  try {
    const result = await salesServices.getById(req.params.id, req.user);
    res.json(result);
  } catch (error) {
    if (error.message.includes('no encontrada')) {
        res.status(404).json({ message: error.message });
    } else {
        res.status(500).json({ message: error.message });
    }
  }
};

module.exports = { createSale, getAllSales, getSaleById };
