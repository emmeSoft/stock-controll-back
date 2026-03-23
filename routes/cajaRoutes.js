const express = require('express');
const router = express.Router();
const cajaController = require('../controllers/cajaController');
const { authMiddleware } = require('../middlewares/authMiddleware');

router.post('/open', authMiddleware, cajaController.openRegister);
router.post('/close', authMiddleware, cajaController.closeRegister);
router.get('/current', authMiddleware, cajaController.getCurrentRegister);

router.get('/history', authMiddleware, cajaController.getRegisterHistory);
router.get('/history/all', authMiddleware, cajaController.getGlobalHistory);
router.get('/registers', authMiddleware, cajaController.getAllRegisters);

module.exports = router;
