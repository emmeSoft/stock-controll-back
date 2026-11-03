# Delta for Sale Cancellation

## ADDED Requirements

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
