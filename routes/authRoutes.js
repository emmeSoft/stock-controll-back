const express = require('express');
const { authMiddleware } = require('../middlewares/authMiddleware');
const router = express.Router();
const authController = require('../controllers/authController');
const rateLimit = require('express-rate-limit');

// Definir limitadores aquí o importarlos si crecen mucho
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: { message: 'Demasiado intentos de login, intenta de nuevo en 15 minutos.' }
});

const sudoLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 5,
  message: { message: 'Límite de validaciones de seguridad excedido. Reintenta en 5 minutos.' }
});

router.post('/login', loginLimiter, authController.login);
router.post('/setup-password', sudoLimiter, authController.setupPassword);
router.get('/check', authMiddleware, authController.checkAuth);
router.post('/sudo', authMiddleware, sudoLimiter, authController.verifySudo); 
router.post('/logout', authController.logout);

module.exports = router;
