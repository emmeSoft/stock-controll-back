# Tasks: Anular Ventas

## Phase 1: Backend Foundation

- [x] 1.1 Update `salesServices.js` to include the `cancel` method with `bcrypt` verification and Prisma transaction.
- [x] 1.2 Implement stock reversal logic within the transaction in `salesServices.js`.
- [x] 1.3 Add `StockHistory` record creation for `RETURN` type in the transaction.

## Phase 2: Backend Wiring

- [x] 2.1 Add `cancelSale` method to `salesController.js` to handle request body and call service.
- [x] 2.2 Register `PATCH /:id/cancel` in `salesRoutes.js` with `requirePermission('sale.cancel')`.

## Phase 3: Frontend Implementation

- [x] 3.1 Update `SaleDetail.jsx` to add the "Anular Venta" button with permission check.
- [x] 3.2 Implement the confirmation modal in `SaleDetail.jsx` that requests the user's password.
- [x] 3.3 Connect the "Anular Venta" button to the backend API via axios.
- [x] 3.4 Handle success/error feedback and refresh the sales list upon successful cancellation.

## Phase 4: Verification

- [ ] 4.1 Verify that the "Anular" button only appears for users with `sale.cancel` permission.
- [ ] 4.2 Test happy path: valid password -> sale cancelled, stock restored, history logged.
- [ ] 4.3 Test error path: wrong password -> 401 error, no changes.
- [ ] 4.4 Test error path: no permission -> 403 error.
