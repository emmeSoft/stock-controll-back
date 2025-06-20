const categoriesController = require('../controllers/categoriesController');

const express = require('express');
const router = express.Router();

router.post('/', categoriesController.createCategories);
router.get('/', categoriesController.getAllCategories);
router.get('/:id', categoriesController.getCategoryById);

module.exports = router;
        