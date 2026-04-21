const express = require('express');
const router = express.Router();
const storesController = require('../controllers/storesController');
const { authMiddleware } = require('../middlewares/authMiddleware');
const { requirePermission } = require('../middlewares/rbacMiddleware');

router.post('/', authMiddleware, requirePermission('store.create'), storesController.createStore);
router.get('/', authMiddleware, requirePermission('store.read'), storesController.getAllStores);
router.get('/:id', authMiddleware, requirePermission('store.read'), storesController.getStoreById);
router.put('/:id', authMiddleware, requirePermission('store.update'), storesController.updateStore);
router.put('/:id/active', authMiddleware, requirePermission('store.delete'), storesController.toggleActiveStatus);

module.exports = router;
