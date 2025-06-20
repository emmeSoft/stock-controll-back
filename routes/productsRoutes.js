const productsController = require('../controllers/productsController');

const express = require('express');
const router = express.Router();

router.post('/', productsController.createProduct);
router.get('/', productsController.getAllProducts);
router.get('/:id', productsController.getProductById);

module.exports = router;
        