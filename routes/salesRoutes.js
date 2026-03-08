const express = require('express');
const router = express.Router();
const salesController = require('../controllers/salesController');
const { authMiddleware } = require('../middlewares/authMiddleware');

router.post('/', authMiddleware, salesController.createSale);
router.get('/', authMiddleware, salesController.getAllSales);

module.exports = router;
