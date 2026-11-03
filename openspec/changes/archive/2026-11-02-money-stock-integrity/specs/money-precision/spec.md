# Money Precision Specification

## Purpose

Define storage, arithmetic, and API-boundary rules for monetary values: Decimal storage, Decimal arithmetic, HALF_UP rounding, and Decimal→Number serialization at every response boundary, preventing float drift and raw-type leakage to the frontend.

## Requirements

### Requirement: Decimal Storage for Monetary Fields

The system MUST store every monetary field as `Decimal(12,2)`. No monetary field MUST use `Float`. The dead `payment` model MUST NOT exist.

#### Scenario: Schema uses Decimal for all money fields

- GIVEN the deployed Prisma schema
- WHEN inspecting any monetary field's column type (order, orderDetail, product.price, CashRegister, CashMovement, OrderPayment, CurrentAccount, CurrentAccountMovement, AppliedDiscount)
- THEN it MUST be `DECIMAL(12,2)`, never `Float`
- AND the `payment` model MUST NOT exist

### Requirement: Decimal Arithmetic and Rounding

The system MUST perform monetary arithmetic via `decimal.js`, never native operators (`+`, `<`, `===`) on Decimal values, and MUST round every monetary value to 2 decimals using `HALF_UP` at the API boundary, including `AppliedDiscount.amount`.

#### Scenario: Exact decimal addition avoids float drift

- GIVEN charges of 1234.56 and 789.12 on a current account
- WHEN the balance is computed
- THEN it MUST equal exactly 2023.68, with no floating-point error

#### Scenario: HALF_UP rounding applied consistently

- GIVEN a computed monetary value with more than 2 decimal digits
- WHEN it is persisted or serialized
- THEN it MUST be rounded to 2 decimals using HALF_UP

### Requirement: Decimal-to-Number Serialization at API Boundary

The system MUST convert every Decimal value to a `Number` before including it in an API response. No API response MUST contain a raw Decimal.

#### Scenario: Monetary field serializes as JSON number

- GIVEN any API response containing a monetary field
- WHEN the response body is parsed as JSON
- THEN the field MUST be a JSON `number`, never a `string`
- AND the existing frontend contract MUST remain unchanged (no frontend code changes required)

### Requirement: Movement Amount Validation

The system MUST reject a `createMovement` request whose `amount` is not finite and positive.

#### Scenario: Rejects non-positive or non-finite amount

- GIVEN a `createMovement` request with `amount` of `0`, a negative value, or `NaN`
- WHEN the request is processed
- THEN it MUST be rejected with a validation error
- AND no movement MUST be created and `expectedAmount` MUST NOT change

#### Scenario: Accepts valid positive amount

- GIVEN a `createMovement` request with `amount: 150.00`
- WHEN the request is processed
- THEN the movement MUST be created
- AND `expectedAmount` MUST be updated accordingly
