# Tasks: Cuentas Corrientes

## Phase 1: Database & RBAC

- [x] 1.1 Update `prisma/schema.prisma` with `CurrentAccount` and `CurrentAccountMovement` models.
- [x] 1.2 Run Prisma migration and regenerate client.
- [x] 1.3 Seed/Create new permissions: `account.view`, `account.open`, `account.close`, `account.payment`, `account.audit`.

## Phase 2: Backend Services

- [x] 2.1 Create `currentAccountServices.js` with methods for list, detail, open, close, and register payment.
- [x] 2.2 Modify `salesServices.js` to support partial payments and current account balance updates in the create transaction.
- [x] 2.3 Create `currentAccountController.js` and register routes in `currentAccountRoutes.js`.
- [x] 2.4 Update `clientServices.js` to include current account information in client detail responses.

## Phase 3: Frontend Foundation

- [x] 3.1 Add "Cuentas Corrientes" to `Sidebar.jsx`.
- [x] 3.2 Create Current Accounts List page (`AccountList.jsx`).
- [x] 3.3 Create Account Detail modal with movement history.
- [x] 3.4 Create "Realizar Pago" modal with search and ticket generation.

## Phase 4: Frontend Integration

- [x] 4.1 Update `NewSale.jsx` to enable "Cuenta Corriente" method for eligible clients.
- [x] 4.2 Implement partial payment UI in `NewSale.jsx` (Amount Paid vs. Total).
- [x] 4.3 Update `SaleDetail.jsx` and `SaleSuccessModal.jsx` to show debt/balance info.
- [x] 4.4 Integrate current account status in `ClientDetail.jsx`.

## Phase 5: Verification

- [x] 5.1 Verify permission enforcement (Vendedor restrictions).
- [x] 5.2 Verify atomic balance updates during sales and payments.
- [x] 5.3 Verify Cash Register integration for CC payments.
- [x] 5.4 Test closing accounts with non-zero balance.
