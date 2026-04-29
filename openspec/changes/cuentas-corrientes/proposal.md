# Proposal: Cuentas Corrientes (Current Accounts)

## Intent

Implement a comprehensive "Cuentas Corrientes" system to allow clients to purchase on credit, make partial payments during sales, and pay off their debt through a dedicated module. This feature is critical for wholesale or regular customer workflows where immediate payment isn't always possible or required.

## Scope

### In Scope
- **Backend Models**: `CurrentAccount` (status, balance) and `CurrentAccountMovement` (audit log).
- **Sales Integration**: Support for "Cuenta Corriente" payment method in `salesServices.js`.
- **Partial Payments**: Ability to register sales where `paidAmount < totalAmount`, with the remainder moving to the current account.
- **Dedicated Module**: Sidebar section for listing accounts, viewing details, and registering debt payments.
- **Security**: RBAC enforcement for opening/closing accounts and registering payments.
- **Reporting**: Detailed movement history (Sales vs. Payments) and balance tracking.

### Out of Scope
- Automatic interest calculation for overdue debt.
- Credit limits (max debt allowed) — deferred to a future phase.
- Multiple current accounts per client (only one active account per store/client).

## Capabilities

### New Capabilities
- `current-account-management`: Ability to open, close, and view client accounts.
- `deferred-payment-processing`: Ability to register payments specifically to reduce current account debt, generating a payment ticket.
- `current-account-reporting`: Detailed movement log showing sales, payments, and resulting balances.

### Modified Capabilities
- `sales-processing`: Updated to handle "Cuenta Corriente" method and partial payments.
- `client-management`: Client profile now includes current account status and balance.

## Approach

1.  **Schema Extension**: Add `CurrentAccount` and `CurrentAccountMovement` models.
2.  **Sales Logic Update**: Modify `salesServices.js` to detect "Cuenta Corriente" in `paymentBreakdown`. If present, calculate `debt = computedTotal - totalPaid` and create a `CurrentAccountMovement`.
3.  **Payment Module**: Create `currentAccountServices.js` to handle `PAYMENT` movements. These must also register an `INCOME` in the `CashRegister`.
4.  **Frontend**: Build the new section in the sidebar and update the sale/client detail modals.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `backend/prisma/schema.prisma` | Modified | New models and relations. |
| `backend/services/salesServices.js` | Modified | Integration with partial payments. |
| `backend/services/currentAccountServices.js` | New | Core logic for the module. |
| `frontend/src/pages/sales/NewSale.jsx` | Modified | UI for partial payments and CC method. |
| `frontend/src/pages/accounts` | New | New module pages. |
| `frontend/src/layouts/Sidebar.jsx` | Modified | New navigation item. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Race Conditions on Balance | Medium | Use atomic increments/decrements inside Prisma transactions. |
| Negative Balances | Low | Validation logic to ensure payments don't exceed debt (unless intentional credit). |
| Improper CC usage | Medium | Strict validation: Client must not be "Consumidor Final" and account must be OPEN. |

## Rollback Plan

The database changes are additive (new tables). If the logic fails, we can revert the code changes and the CC payment method will simply not be available. Existing debt data will remain in the new tables.

## Success Criteria

- [ ] "Vendedor" can see balances but cannot open/close accounts or register external payments.
- [ ] Sales with "Cuenta Corriente" correctly update the client's balance.
- [ ] A dedicated "Pago a Cuenta Corriente" generates a ticket and adds income to the cash register.
- [ ] Account history clearly distinguishes between "Sale" debt and "Payment" credits.
