const categoriesController = require('../controllers/categoriesController');

const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middlewares/authMiddleware');

router.post('/', authMiddleware, categoriesController.createCategories);
router.get('/', authMiddleware, categoriesController.getAllCategories);
router.get('/:id', authMiddleware, categoriesController.getCategoryById);
router.put('/:id', authMiddleware, categoriesController.updateCategories);
router.put('/:id/active', authMiddleware, categoriesController.toggleActiveStatus);

module.exports = router;
        