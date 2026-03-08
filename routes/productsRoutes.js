const productsController = require('../controllers/productsController');

const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middlewares/authMiddleware');

router.post('/', authMiddleware, productsController.createProduct);
router.get('/', authMiddleware, productsController.getAllProducts);
router.get('/:id', authMiddleware, productsController.getProductById);
router.put('/:id', authMiddleware, productsController.updateProduct);
router.put('/:id/active', authMiddleware, productsController.toggleActiveStatus);

module.exports = router;
        