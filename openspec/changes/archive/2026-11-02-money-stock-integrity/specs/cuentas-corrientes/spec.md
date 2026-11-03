# Delta for Cuentas Corrientes

## MODIFIED Requirements

### Requirement: Account Management

The system MUST allow "Encargado", "Administrador", and "Sistema" to open current accounts for existing clients. Only "Administrador" and "Sistema" SHALL be allowed to close an account, and closing MUST be enforced as an atomic, DB-level conditional update (`WHERE balance = 0`), never a pre-check read-then-write.
(Previously: a pre-transaction read-then-`if`, vulnerable to a concurrent payment landing between the check and the write.)

#### Scenario: Opening an account

- GIVEN a client "Juan Perez" without a current account
- AND an authorized user (Encargado)
- WHEN the user initiates "Open Account" for Juan Perez
- THEN the system MUST create a new CurrentAccount record with balance 0
- AND the status MUST be "OPEN"

#### Scenario: Closing an account with balance

- GIVEN a client with an open account and balance $1000
- WHEN an Administrator attempts to close the account
- THEN the system MUST deny the action and show an error "Cannot close account with pending balance."

#### Scenario: Closing an account rejected by a concurrent payment

- GIVEN a client with an open account and balance $0
- AND a concurrent payment request about to move the balance away from 0
- WHEN the close request and the concurrent payment race
- THEN at most one of the two operations MUST succeed
- AND IF the payment lands first, the close MUST be rejected, not silently closed with a nonzero balance

### Requirement: Debt Payment

The system MUST allow registering specific payments to a client's current account balance ONLY if the balance is sufficient to cover the payment amount, enforced via an atomic, DB-level conditional update (`WHERE balance >= amount`), never a pre-transaction read-then-`if`. These payments MUST be recorded in the active Cash Register.
(Previously: sufficiency was checked via a pre-transaction `if`, allowing two concurrent payments to both pass the check before either write landed.)

#### Scenario: Registering a payment

- GIVEN a client with a debt of $3000
- WHEN the user registers a payment of $2000 via "Efectivo"
- THEN the system MUST decrease the account balance to $1000
- AND create a movement record of type "PAYMENT" for -$2000
- AND create an INCOME movement in the active Cash Register for $2000
- AND generate a payment ticket.

#### Scenario: Exact-balance payment enables account closing

- GIVEN a current account with charges totaling 1234.56 + 789.12
- WHEN the client pays exactly 2023.68
- THEN the system MUST accept the payment
- AND the account balance MUST become exactly 0
- AND a subsequent close request MUST succeed

#### Scenario: Concurrent payments exceeding balance

- GIVEN a current account with balance $1000
- WHEN two payment requests of $800 each are submitted concurrently
- THEN exactly one payment MUST succeed and the other MUST be rejected
- AND the account balance MUST NEVER go negative
