const express    = require('express');
const router     = express.Router();
const ctrl       = require('../controllers/currentAccountController');
const { authMiddleware }    = require('../middlewares/authMiddleware');
const { requirePermission } = require('../middlewares/rbacMiddleware');

// ── Visualización ─────────────────────────────────────────────────
router.get(
  '/',
  authMiddleware,
  requirePermission('account.view'),
  ctrl.getList
);

router.get(
  '/client/:clientId',
  authMiddleware,
  requirePermission('account.view'),
  ctrl.getByClient
);

router.get(
  '/:id',
  authMiddleware,
  requirePermission('account.detail'),
  ctrl.getDetail
);

// ── Gestión ───────────────────────────────────────────────────────
router.post(
  '/open',
  authMiddleware,
  requirePermission('account.open'),
  ctrl.open
);

router.patch(
  '/:id/close',
  authMiddleware,
  requirePermission('account.close'),
  ctrl.close
);

// ── Pagos ─────────────────────────────────────────────────────────
router.post(
  '/payment',
  authMiddleware,
  requirePermission('account.payment'),
  ctrl.registerPayment
);

module.exports = router;
