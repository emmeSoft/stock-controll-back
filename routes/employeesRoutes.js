const employeeController = require('../controllers/employeeController');

const express = require('express');
const router = express.Router();

router.post('/', employeeController.createEmployee);
router.get('/', employeeController.getAllEmployees);
router.get('/:id', employeeController.getEmployeeById);
router.put('/:id', employeeController.updateEmployee);
router.put('/:id/active', employeeController.toggleActiveStatus);

module.exports = router;
