const express = require('express');
const router = express.Router();
const stockHistoryController = require('../controllers/stockHistoryController');
const { authMiddleware } = require('../middlewares/authMiddleware');
const { requirePermission } = require('../middlewares/rbacMiddleware');

router.get('/export', authMiddleware, requirePermission('inventory.read'), stockHistoryController.exportStockHistory);
router.get('/', authMiddleware, requirePermission('inventory.read'), stockHistoryController.getAllStockHistory);
router.get('/:productId', authMiddleware, requirePermission('inventory.read'), stockHistoryController.getProductStockHistory);

module.exports = router;
