const express = require('express');
const router = express.Router();
const stockHistoryController = require('../controllers/stockHistoryController');
const { authMiddleware } = require('../middlewares/authMiddleware');

router.get('/', authMiddleware, stockHistoryController.getAllStockHistory);
router.get('/:productId', authMiddleware, stockHistoryController.getProductStockHistory);

module.exports = router;
