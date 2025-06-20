const suppliersController = require('../controllers/suppliersController');

const express = require('express');
const router = express.Router();

router.post('/', suppliersController.createSuppliers);
router.get('/', suppliersController.getAllSuppliers);
router.get('/:id', suppliersController.getSupplierById);

module.exports = router;
    