const clientController = require('../controllers/clientController');

const express = require('express');
const router = express.Router();

router.post('/', clientController.createClient);
router.get('/', clientController.getAllClients);
router.get('/:id', clientController.getClientDetails);
router.put('/:id', clientController.updateClient);
router.put('/:id/disable', clientController.disableClient);
router.put('/:id/enable', clientController.enableClient); 

module.exports = router;
