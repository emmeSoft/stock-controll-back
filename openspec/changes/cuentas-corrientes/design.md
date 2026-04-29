# Design: Cuentas Corrientes

## Technical Approach

We will implement a deferred payment system by adding two new tables to the database. The core logic will reside in a new service `currentAccountServices.js` and will be tightly integrated into the existing `salesServices.js` transaction.

## Architecture Decisions

### Decision: Movement Tracking
**Choice**: Store both `totalAmount`, `paidAmount`, and `debtAmount` in each movement.
**Rationale**: This allows the frontend to clearly "discriminate" (as per requirement) how much of a sale was paid upfront and how much went to the current account without re-calculating from the `order` table.

### Decision: Balance Updates
**Choice**: Use atomic `increment`/`decrement` operations within Prisma transactions.
**Rationale**: This prevents balance desynchronization if multiple operations occur simultaneously.

### Decision: Cash Register Integration
**Choice**: Payments to current accounts MUST create a `CashMovement` of type `INCOME`.
**Rationale**: Ensures that the cash drawer matches the system records at the end of the shift.

## Data Flow

    [Frontend: NewSale] ──(SalesData + CC Method)──→ [salesServices.create]
                                                              │
                                                      (Prisma Transaction)
                                                              │
                    ┌─────────────────────────────────────────┴──────────────────────────┐
                    │                                                                    │
            [Standard Sale Logic]                                             [CurrentAccount Update]
            - Stock Decr.                                                     - Check account status
            - Order Create                                                    - Increment Balance
                                                                              - Log CC Movement

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `backend/prisma/schema.prisma` | Modify | Add `CurrentAccount` and `CurrentAccountMovement` models. |
| `backend/services/salesServices.js` | Modify | Allow partial payments and integrate CC balance updates. |
| `backend/services/currentAccountServices.js` | Create | CRUD and payment logic for accounts. |
| `frontend/src/pages/accounts` | Create | New module pages (List, Detail, Payment). |
| `frontend/src/pages/sales/NewSale.jsx` | Modify | Support CC method and partial payments UI. |

## Interfaces / Contracts

### `CurrentAccount` Model
```prisma
model CurrentAccount {
  id        String   @id @default(cuid())
  clientId  String   @unique
  storeId   String
  balance   Float    @default(0)
  status    String   @default("OPEN")
  createdAt DateTime @default(now())
  // ...
}
```

### `CurrentAccountMovement` Model
```prisma
model CurrentAccountMovement {
  id               String   @id @default(cuid())
  currentAccountId String
  userId           String
  type             String   // SALE, PAYMENT, ADJUSTMENT
  totalAmount      Float
  paidAmount       Float
  debtAmount       Float
  balanceResult    Float
  orderId          String?
  createdAt        DateTime @default(now())
  // ...
}
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | `salesServices.create` with CC | Verify balance increments correctly for partial payments. |
| Integration | `PATCH /accounts/:id/payment` | Verify account balance decreases and CashRegister income is logged. |
| Security | RBAC | Ensure Vendedor cannot open accounts or register external payments. |

## Migration / Rollout

A Prisma migration is required to add the new models. Existing clients will NOT have a current account by default (must be opened manually).
