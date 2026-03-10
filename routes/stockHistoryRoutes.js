const express = require('express');
const router = express.Router();
const stockHistoryController = require('../controllers/stockHistoryController');

router.get('/', stockHistoryController.getAllStockHistory);
router.get('/:productId', stockHistoryController.getProductStockHistory);

module.exports = router;
