const categoriesController = require('../controllers/categoriesController');

const express = require('express');
const router = express.Router();

router.post('/', categoriesController.createCategories);
router.get('/', categoriesController.getAllCategories);
router.get('/:id', categoriesController.getCategoryById);
router.put('/:id', categoriesController.updateCategories);
router.put('/:id/active', categoriesController.toggleActiveStatus);

module.exports = router;
        