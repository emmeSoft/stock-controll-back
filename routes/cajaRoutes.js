const express = require('express');
const router = express.Router();
const cajaController = require('../controllers/cajaController');
const { authMiddleware } = require('../middlewares/authMiddleware');

router.post('/open', authMiddleware, cajaController.openRegister);
router.post('/close', authMiddleware, cajaController.closeRegister);
router.get('/current', authMiddleware, cajaController.getCurrentRegister);

module.exports = router;
