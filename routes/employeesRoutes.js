const employeeController = require('../controllers/employeeController');

const express = require('express');
const router = express.Router();
const { authMiddleware, requireRole } = require('../middlewares/authMiddleware');

router.post('/', authMiddleware, requireRole(['SUPERADMIN', 'ADMIN']), employeeController.createEmployee);
router.get('/', authMiddleware, requireRole(['SUPERADMIN', 'ADMIN']), employeeController.getAllEmployees);
router.get('/:id', authMiddleware, requireRole(['SUPERADMIN', 'ADMIN']), employeeController.getEmployeeById);
router.put('/:id', authMiddleware, requireRole(['SUPERADMIN', 'ADMIN']), employeeController.updateEmployee);
router.put('/:id/active', authMiddleware, requireRole(['SUPERADMIN', 'ADMIN']), employeeController.toggleActiveStatus);

module.exports = router;
