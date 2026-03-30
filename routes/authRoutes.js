const express = require('express');
const { authMiddleware } = require('../middlewares/authMiddleware');
const router = express.Router();
const authController = require('../controllers/authController');

router.post('/login', authController.login);
router.post('/setup-password', authController.setupPassword);
router.get('/check', authMiddleware, authController.checkAuth);
router.post('/sudo', authMiddleware, authController.verifySudo); // Nuevo: reto de contraseña
router.post('/logout', authController.logout);

module.exports = router;
