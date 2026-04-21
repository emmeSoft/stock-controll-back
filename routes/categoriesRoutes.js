const categoriesController = require('../controllers/categoriesController');

const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middlewares/authMiddleware');
const { requirePermission } = require('../middlewares/rbacMiddleware');

router.post('/', authMiddleware, requirePermission('category.create'), categoriesController.createCategories);
router.get('/', authMiddleware, requirePermission('category.read'), categoriesController.getAllCategories);
router.get('/export', authMiddleware, requirePermission('category.read'), categoriesController.exportCategories);
router.get('/:id', authMiddleware, requirePermission('category.read'), categoriesController.getCategoryById);
router.put('/:id', authMiddleware, requirePermission('category.update'), categoriesController.updateCategories);
router.put('/:id/active', authMiddleware, requirePermission('category.update'), categoriesController.toggleActiveStatus);

module.exports = router;
        