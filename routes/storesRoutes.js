const express = require('express');
const router = express.Router();
const storesController = require('../controllers/storesController');
const { authMiddleware, requireRole } = require('../middlewares/authMiddleware');

router.post('/', authMiddleware, requireRole(['SUPERADMIN']), storesController.createStore);
router.get('/', authMiddleware, storesController.getAllStores);
router.get('/:id', authMiddleware, storesController.getStoreById);
router.put('/:id', authMiddleware, requireRole(['SUPERADMIN', 'ADMIN']), storesController.updateStore);
router.put('/:id/active', authMiddleware, requireRole(['SUPERADMIN']), storesController.toggleActiveStatus);

module.exports = router;
