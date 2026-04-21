const express = require('express');
const router = express.Router();
const cajaController = require('../controllers/cajaController');
const { authMiddleware } = require('../middlewares/authMiddleware');
const { requirePermission } = require('../middlewares/rbacMiddleware');

router.post('/open', authMiddleware, requirePermission('caja.open'), cajaController.openRegister);
router.post('/close', authMiddleware, requirePermission('caja.close'), cajaController.closeRegister);
router.get('/current', authMiddleware, requirePermission('caja.read'), cajaController.getCurrentRegister);

router.get('/history', authMiddleware, requirePermission('caja.read'), cajaController.getRegisterHistory);
router.get('/history/all', authMiddleware, requirePermission('caja.read'), cajaController.getGlobalHistory);
router.get('/registers/export', authMiddleware, requirePermission('caja.read'), cajaController.exportRegisters);
router.get('/registers', authMiddleware, requirePermission('caja.read'), cajaController.getAllRegisters);

module.exports = router;
