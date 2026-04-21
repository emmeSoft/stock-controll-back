const clientController = require('../controllers/clientController');

const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middlewares/authMiddleware');
const { requirePermission } = require('../middlewares/rbacMiddleware');

router.post('/', authMiddleware, requirePermission('client.create'), clientController.createClient);
router.get('/export', authMiddleware, requirePermission('client.read'), clientController.exportClients);
router.get('/', authMiddleware, requirePermission('client.read'), clientController.getAllClients);
router.get('/:id', authMiddleware, requirePermission('client.read'), clientController.getClientDetails);
router.put('/:id', authMiddleware, requirePermission('client.update'), clientController.updateClient);
router.put('/:id/active', authMiddleware, requirePermission('client.update'), clientController.toggleActiveStatus);


module.exports = router;
