const employeeController = require('../controllers/employeeController');

const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middlewares/authMiddleware');
const { requirePermission } = require('../middlewares/rbacMiddleware');

router.post('/', authMiddleware, requirePermission('user.create'), employeeController.createEmployee);
router.get('/', authMiddleware, requirePermission('user.read'), employeeController.getAllEmployees);
router.get('/export', authMiddleware, requirePermission('user.read'), employeeController.exportEmployees);
router.get('/:id', authMiddleware, requirePermission('user.read'), employeeController.getEmployeeById);
router.put('/:id', authMiddleware, requirePermission('user.update'), employeeController.updateEmployee);
router.put('/:id/active', authMiddleware, requirePermission('user.update'), employeeController.toggleActiveStatus);
router.put('/:id/reset-pin', authMiddleware, requirePermission('user.update'), employeeController.resetPassword);

module.exports = router;
