const clientController = require('../controllers/clientController');

const express = require('express');
const router = express.Router();

router.post('/', clientController.createClient);
router.get('/', clientController.getAllClients);
router.get('/:id', clientController.getClientDetails);

module.exports = router;
