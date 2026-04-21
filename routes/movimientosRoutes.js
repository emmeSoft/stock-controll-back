const express = require('express');
const router = express.Router();
const movimientosController = require('../controllers/movimientosController');
const { authMiddleware } = require('../middlewares/authMiddleware');
const { requirePermission } = require('../middlewares/rbacMiddleware');

router.post('/', authMiddleware, requirePermission('movimiento.create'), movimientosController.createMovement);
router.get('/export', authMiddleware, requirePermission('movimiento.read'), movimientosController.exportMovements);
router.get('/register/:registerId', authMiddleware, requirePermission('movimiento.read'), movimientosController.getMovements);

module.exports = router;
