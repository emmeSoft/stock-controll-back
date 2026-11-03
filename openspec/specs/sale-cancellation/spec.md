# Sale Cancellation Specification

## Purpose

Define the requirements for voiding a completed sale, including security checks, data integrity, and stock reversal.

## Requirements

### Requirement: Void Sale Authorization
The system MUST verify that the user has the `sale.cancel` permission and MUST verify the user's password before allowing a sale to be voided.

#### Scenario: Authorized Voiding
- GIVEN a completed sale with ID "SALE-123"
- AND a user with `sale.cancel` permission
- WHEN the user initiates the voiding and provides the CORRECT password
- THEN the system MUST proceed with the cancellation
- AND the sale status MUST change to "CANCELLED"

#### Scenario: Unauthorized Voiding (No Permission)
- GIVEN a completed sale
- AND a user WITHOUT `sale.cancel` permission
- WHEN the user attempts to void the sale
- THEN the system MUST deny the action with a 403 Forbidden error

#### Scenario: Unauthorized Voiding (Wrong Password)
- GIVEN a completed sale
- AND a user with `sale.cancel` permission
- WHEN the user attempts to void the sale but provides an INCORRECT password
- THEN the system MUST deny the action with a 401 Unauthorized error
- AND the sale status MUST NOT change

### Requirement: Stock Reversal
Upon successful cancellation of a sale, the system MUST return all items in the sale to the inventory of the corresponding store.

#### Scenario: Inventory Restored
- GIVEN a sale of 5 units of "Product A" (Current Stock: 10)
- WHEN the sale is cancelled
- THEN the stock of "Product A" MUST be updated to 15
- AND a `StockHistory` entry MUST be created with type "RETURN" and movement amount +5.

### Requirement: Transactional Integrity
All operations related to sale cancellation (status update, stock reversal, history log) MUST be executed within a single database transaction.

#### Scenario: Atomicity on Failure
- GIVEN a sale cancellation process
- WHEN the stock reversal fails (e.g., database error)
- THEN the sale status MUST NOT be updated
- AND no history entries MUST be created
- AND the system MUST revert all changes attempted during the transaction.

### Requirement: Debt Reversal on Cancellation

When cancelling a sale that was paid fully or partially via current account ("Cuenta Corriente"), the system MUST reverse the corresponding debt on the client's `CurrentAccount` within the same transaction as the cancellation, via an `ADJUSTMENT` movement (not reusing the original movement's `orderId`, which is `@unique` and already held by it).

#### Scenario: Cancelling a fully-credit sale reverses the debt

- GIVEN a fully-credit sale that increased a client's current account balance by $3000
- WHEN the sale is cancelled
- THEN the client's current account balance MUST return to its pre-sale value
- AND an `ADJUSTMENT` movement MUST be created reflecting the reversal
- AND the stock reversal and the debt reversal MUST both occur within the same database transaction

#### Scenario: Cancelling a cash sale does not touch the current account

- GIVEN a sale paid entirely in cash with no current-account involvement
- WHEN the sale is cancelled
- THEN no `CurrentAccount` or `CurrentAccountMovement` record MUST be created or modified
