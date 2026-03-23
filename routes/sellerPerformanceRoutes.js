const express = require('express');
const router = express.Router();
const sellerPerformanceController = require('../controllers/sellerPerformanceController');
const { authMiddleware } = require('../middlewares/authMiddleware');

router.get('/', authMiddleware, sellerPerformanceController.getSellerPerformance);

module.exports = router;
