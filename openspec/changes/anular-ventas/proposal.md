# Proposal: Anular Ventas

## Intent

Implement a robust mechanism to void/cancel sales that were performed incorrectly. This ensures stock integrity, accounting accuracy, and provides an audit trail for corrections.

## Scope

### In Scope
- Backend: `PATCH /api/sales/:id/cancel` endpoint.
- Backend: Implementation of cancellation logic with stock reversal and **password verification** in `salesServices.js`.
- Backend: Enforcement of `sale.cancel` permission via RBAC middleware.
- Frontend: "Anular Venta" button in `SaleDetail.jsx`.
- Frontend: Confirmation modal requiring **password re-entry**.
- History: Record `RETURN` movement in `StockHistory`.


### Out of Scope
- Automatic refund to external payment gateways (not integrated yet).
- Partial cancellations (for now, only full voiding is supported).

## Capabilities

### New Capabilities
- `sale-cancellation`: Ability to void a completed sale and automatically revert inventory state.

### Modified Capabilities
- `inventory-management`: Now supports `RETURN` movement type originating from cancelled sales.

## Approach

Use a **Status Update** approach. The order status is changed to `CANCELLED`, and all items in the order are returned to stock within a single database transaction. The system **MUST verify the user's password** before executing the cancellation to ensure authenticity. StockHistory entries are created for each returned item.


## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `backend/routes/salesRoutes.js` | Modified | Add cancel endpoint. |
| `backend/controllers/salesController.js` | Modified | Add cancelSale handler. |
| `backend/services/salesServices.js` | Modified | Add transactional cancel logic. |
| `frontend/src/pages/sales/SaleDetail.jsx` | Modified | Add Void button and logic. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Stock desynchronization | Low | Use Prisma transaction for all updates. |
| Unauthorized access | Medium | Enforce `sale.cancel` permission in backend. |
| Race conditions | Low | Transaction isolation. |

## Rollback Plan

Revert code changes. The database state can be manually corrected if needed, as the status update is non-destructive to the original data.

## Success Criteria

- [ ] A user with `sale.cancel` permission can void a sale.
- [ ] Stock of products is correctly incremented after cancellation.
- [ ] `StockHistory` shows a `RETURN` entry for each item.
- [ ] A user without permission receives a 403 error.
