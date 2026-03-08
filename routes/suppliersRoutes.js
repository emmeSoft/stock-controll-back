const suppliersController = require('../controllers/suppliersController');

const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middlewares/authMiddleware');

router.post('/', authMiddleware, suppliersController.createSuppliers);
router.get('/', authMiddleware, suppliersController.getAllSuppliers);
router.get('/:id', authMiddleware, suppliersController.getSupplierById);
router.put('/:id', authMiddleware, suppliersController.updateSuppliers);
router.put('/:id/active', authMiddleware, suppliersController.toggleActiveStatus);

module.exports = router;
    