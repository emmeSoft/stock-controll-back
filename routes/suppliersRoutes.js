const suppliersController = require('../controllers/suppliersController');

const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middlewares/authMiddleware');
const { requirePermission } = require('../middlewares/rbacMiddleware');

router.post('/', authMiddleware, requirePermission('supplier.create'), suppliersController.createSuppliers);
router.get('/export', authMiddleware, requirePermission('supplier.read'), suppliersController.exportSuppliers);
router.get('/', authMiddleware, requirePermission('supplier.read'), suppliersController.getAllSuppliers);
router.get('/:id', authMiddleware, requirePermission('supplier.read'), suppliersController.getSupplierById);
router.put('/:id', authMiddleware, requirePermission('supplier.update'), suppliersController.updateSuppliers);
router.put('/:id/active', authMiddleware, requirePermission('supplier.update'), suppliersController.toggleActiveStatus);

module.exports = router;
    
