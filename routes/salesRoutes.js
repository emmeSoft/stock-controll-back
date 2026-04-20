const express = require('express');
const router = express.Router();
const salesController = require('../controllers/salesController');
const { authMiddleware } = require('../middlewares/authMiddleware');
const { requirePermission } = require('../middlewares/rbacMiddleware');

router.post('/', authMiddleware, requirePermission('sale.create'), salesController.createSale);
router.get('/export', authMiddleware, requirePermission('sale.read'), salesController.exportSales);
router.get('/', authMiddleware, requirePermission('sale.read'), salesController.getAllSales);
router.get('/:id', authMiddleware, requirePermission('sale.read'), salesController.getSaleById);

module.exports = router;
