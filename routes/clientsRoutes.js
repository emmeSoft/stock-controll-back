const clientController = require('../controllers/clientController');

const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middlewares/authMiddleware');

router.post('/', authMiddleware, clientController.createClient);
router.get('/', authMiddleware, clientController.getAllClients);
router.get('/:id', authMiddleware, clientController.getClientDetails);
router.put('/:id', authMiddleware, clientController.updateClient);
router.put('/:id/active', authMiddleware, clientController.toggleActiveStatus);


module.exports = router;
