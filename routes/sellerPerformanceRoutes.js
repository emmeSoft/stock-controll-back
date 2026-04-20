const express = require('express');
const router = express.Router();
const sellerPerformanceController = require('../controllers/sellerPerformanceController');
const { authMiddleware } = require('../middlewares/authMiddleware');
const { requirePermission } = require('../middlewares/rbacMiddleware');

router.get('/export', authMiddleware, requirePermission('seller.performance.read'), sellerPerformanceController.exportPerformance);
router.get('/', authMiddleware, requirePermission('seller.performance.read'), sellerPerformanceController.getSellerPerformance);

module.exports = router;
