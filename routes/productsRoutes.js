const productsController = require('../controllers/productsController');

const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middlewares/authMiddleware');
const { requirePermission } = require('../middlewares/rbacMiddleware');

router.post('/', authMiddleware, requirePermission('product.create'), productsController.createProduct);
router.get('/export', authMiddleware, requirePermission('product.read'), productsController.exportProducts);
router.get('/', authMiddleware, requirePermission('product.read'), productsController.getAllProducts);
router.get('/:id', authMiddleware, requirePermission('product.read'), productsController.getProductById);
router.put('/:id', authMiddleware, requirePermission('product.update'), productsController.updateProduct);
router.put('/:id/active', authMiddleware, requirePermission('product.update'), productsController.toggleActiveStatus);
router.put('/:id/stock', authMiddleware, requirePermission('inventory.adjust'), productsController.adjustStock);

module.exports = router;
        