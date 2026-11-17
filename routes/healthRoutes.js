const express = require('express');
const router = express.Router();
const healthController = require('../controllers/healthController');

// Sin authMiddleware, sin requirePermission: el wake check debe poder
// ejecutarse siempre, para cualquiera, sin excepción.
router.get('/', healthController.check);

module.exports = router;
