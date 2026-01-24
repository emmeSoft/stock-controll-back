const suppliersController = require('../controllers/suppliersController');

const express = require('express');
const router = express.Router();

router.post('/', suppliersController.createSuppliers);
router.get('/', suppliersController.getAllSuppliers);
router.get('/:id', suppliersController.getSupplierById);
router.put('/:id', suppliersController.updateSuppliers);
router.put('/:id/active', suppliersController.toggleActiveStatus);

module.exports = router;
    