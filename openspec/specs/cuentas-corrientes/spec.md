# Cuentas Corrientes Specification

## Purpose
Define the requirements for managing client current accounts, deferred payments, and debt tracking.

## Requirements

### Requirement: Account Management
The system MUST allow "Encargado", "Administrador", and "Sistema" to open current accounts for existing clients. Only "Administrador" and "Sistema" SHALL be allowed to close an account, and ONLY if the balance is zero.

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

### Requirement: Sales Integration (Deferred Payment)
In the sales module, the "Cuenta Corriente" payment method MUST be available ONLY if the selected client is NOT "Consumidor Final" and has an OPEN current account.

#### Scenario: Partial payment in sale
- GIVEN a sale with total $5000
- AND a client with an OPEN current account
- WHEN the user selects "Cuenta Corriente" and pays $2000 in cash
- THEN the system MUST register the sale
- AND the client's current account balance MUST increase by $3000
- AND a movement record of type "SALE" MUST be created for $3000

### Requirement: Debt Payment
The system MUST allow registering specific payments to a client's current account balance. These payments MUST be recorded in the active Cash Register.

#### Scenario: Registering a payment
- GIVEN a client with a debt of $3000
- WHEN the user registers a payment of $2000 via "Efectivo"
- THEN the system MUST decrease the account balance to $1000
- AND create a movement record of type "PAYMENT" for -$2000
- AND create an INCOME movement in the active Cash Register for $2000
- AND generate a payment ticket.

### Requirement: History and Visualization
The system MUST show a detailed list of movements for each account, including date, seller, movement type, total amount, paid amount, and resulting balance.

#### Scenario: Viewing detail
- GIVEN an account with multiple sales and payments
- WHEN the user views the account detail
- THEN the system MUST show a chronologically ordered list of all movements
- AND show the final balance at the footer.
