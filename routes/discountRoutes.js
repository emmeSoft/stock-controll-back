/**
 * discountRoutes.js
 * ─────────────────────────────────────────────────────────────────
 * RBAC por endpoint:
 *
 *  GET    /              → discount.read    (VENDEDOR, ENCARGADO, ADMINISTRADOR, SISTEMA)
 *  GET    /:id           → discount.read
 *  POST   /preview       → discount.read    (preview no requiere create — solo leer reglas)
 *  POST   /              → discount.create  (ENCARGADO, ADMINISTRADOR, SISTEMA)
 *  PUT    /:id           → discount.update  (ENCARGADO, ADMINISTRADOR, SISTEMA)
 *  PATCH  /:id/activate  → discount.update
 *  PATCH  /:id/deactivate→ discount.delete  (ADMINISTRADOR, SISTEMA)
 *  DELETE /:id           → discount.delete  (ADMINISTRADOR, SISTEMA) — hard delete
 * ─────────────────────────────────────────────────────────────────
 */

const express    = require('express');
const router     = express.Router();
const ctrl       = require('../controllers/discountController');
const { authMiddleware }     = require('../middlewares/authMiddleware');
const { requirePermission }  = require('../middlewares/rbacMiddleware');

// Preview — todos los que pueden leer descuentos (incluyendo VENDEDOR en POS)
router.post('/preview', authMiddleware, requirePermission('discount.read'), ctrl.preview);

// Lectura
router.get('/',    authMiddleware, requirePermission('discount.read'),   ctrl.getAll);
router.get('/:id', authMiddleware, requirePermission('discount.read'),   ctrl.getById);

// Escritura — ENCARGADO y ADMINISTRADOR
router.post('/',   authMiddleware, requirePermission('discount.create'), ctrl.create);
router.put('/:id', authMiddleware, requirePermission('discount.update'), ctrl.update);

// Activar/Desactivar
router.patch('/:id/activate',   authMiddleware, requirePermission('discount.update'), ctrl.activate);
router.patch('/:id/deactivate', authMiddleware, requirePermission('discount.delete'), ctrl.deactivate);

// Eliminar físicamente — solo ADMINISTRADOR y SISTEMA
router.delete('/:id', authMiddleware, requirePermission('discount.delete'), ctrl.remove);

module.exports = router;
