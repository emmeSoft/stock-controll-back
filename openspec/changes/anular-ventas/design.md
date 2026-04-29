# Design: Anular Ventas

## Technical Approach

We will implement a transactional cancellation process that updates the order status and reverts inventory changes. Security is ensured by combining RBAC permission checks with a mandatory password verification step on the backend.

## Architecture Decisions

### Decision: Password Verification Method

**Choice**: Use `bcrypt.compare` on the backend inside the sales service.
**Alternatives considered**: Only front-end confirmation, or a dedicated "verify-password" endpoint.
**Rationale**: Verifying on the backend is the only way to prevent front-end manipulation. Putting it inside the cancellation service ensures it's checked right before the sensitive operation.

### Decision: Stock Reversal Logic

**Choice**: Direct `increment` in `tx.product.update` within the transaction.
**Alternatives considered**: Using `adjustStock` service.
**Rationale**: We need granular control within a Prisma transaction to ensure atomicity. Calling external services might complicate transaction propagation.

## Data Flow

    Frontend (Modal) ──(ID + Password)──→ salesController ──→ salesServices (TX START)
                                                                    │
          ┌─────────────────────────────────────────────────────────┴────────────────┐
          │                                                                          │
    Verify Password ──→ Update Order Status (CANCELLED) ──→ Revert Stock ──→ Log StockHistory
          │                                                                          │
          └─────────────────────────────────────────────────────────┬────────────────┘
                                                                    │
    Frontend (Update List) ←───────────────────────────── (TX COMMIT)

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `backend/routes/salesRoutes.js` | Modify | Add `PATCH /:id/cancel` with auth and rbac. |
| `backend/controllers/salesController.js` | Modify | Add `cancelSale` method to handle request and response. |
| `backend/services/salesServices.js` | Modify | Implement `cancel` service with transaction and password check. |
| `frontend/src/pages/sales/SaleDetail.jsx` | Modify | Add "Anular Venta" UI and password modal logic. |

## Interfaces / Contracts

### Backend: `PATCH /api/sales/:id/cancel`
**Body**:
```json
{
  "password": "user-password-here"
}
```
**Response**:
- `200 OK`: `{ message: "Venta anulada correctamente", orderId: "..." }`
- `401 Unauthorized`: Wrong password.
- `403 Forbidden`: No `sale.cancel` permission.

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | `salesServices.cancel` | Test transaction logic and password check. |
| Integration | `PATCH /api/sales/:id/cancel` | Test end-to-end flow with RBAC. |
| Visual | `SaleDetail.jsx` | Verify the password prompt appears and button renders correctly. |

## Migration / Rollout

No data migration required. Feature is new and doesn't affect existing completed sales unless explicitly called.

## Open Questions

- [ ] Should we allow cancelling a sale if the cash register it belongs to is already closed? (Decided: For now, yes, but we might need an audit flag).
