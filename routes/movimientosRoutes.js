const express = require('express');
const router = express.Router();
const movimientosController = require('../controllers/movimientosController');
const { authMiddleware } = require('../middlewares/authMiddleware');

router.post('/', authMiddleware, movimientosController.createMovement);
router.get('/register/:registerId', authMiddleware, movimientosController.getMovements);

module.exports = router;
