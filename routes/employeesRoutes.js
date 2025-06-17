const employeeController = require('../controllers/employeeController');

const express = require('express');
const router = express.Router();

router.post('/', employeeController.createEmployee);
router.get('/', employeeController.getAllEmployees);

module.exports = router;
