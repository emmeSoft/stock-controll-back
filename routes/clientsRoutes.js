const clientController = require('../controllers/clientController');

const express = require('express');
const router = express.Router();

router.post('/', clientController.createClient);
router.get('/', clientController.getAllClients);

module.exports = router;
