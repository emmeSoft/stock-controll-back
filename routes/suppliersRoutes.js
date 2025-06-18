const suppliersController = require('../controllers/suppliersController');

const express = require('express');
const router = express.Router();

router.post('/', suppliersController.createSuppliers);
router.get('/', suppliersController.getAllSuppliers);

module.exports = router;
    