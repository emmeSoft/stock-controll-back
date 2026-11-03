# Spec: Cash Register Integrity

## Overview

This spec ensures that register close operations are exactly-once, their totals remain consistent with all money-bearing operations, and all operations that bind to a register can only succeed if the register is still open at the moment of the money-affecting write.

## Requirements

### Requirement: Exactly-Once Register Close

The system MUST execute `closeRegister` as a single `$transaction` containing the totals read, the totals computation, and the status write, with the write conditioned on `status: 'OPEN'` in the `WHERE` clause. If the conditional write's affected-row count is `0`, the system MUST reject the request with `Object.assign(new Error(msg), { status: 409 })` naming the cause, and MUST NOT modify `closingAmount`, `expectedAmount`, `difference`, or `observation`. `cajaController` MUST forward `error.status` unchanged.

#### Scenario: Concurrent double close

- GIVEN a register in status `OPEN`
- WHEN two `POST /api/caja/close` requests are submitted concurrently for that register
- THEN exactly one request MUST succeed
- AND the other MUST be rejected with `status === 409`
- AND the persisted `closingAmount`, `expectedAmount`, `difference`, and `observation` MUST be the winner's values only, never silently overwritten by the loser

#### Scenario: Close on an already-closed register

- GIVEN a register already in status `CLOSED`
- WHEN `closeRegister` is called on it
- THEN the system MUST return `status === 409` with a message naming the cause (register already closed)
- AND `cajaController` MUST propagate that status code unchanged to the HTTP response

### Requirement: Register-Bound Operation Consistency

The system MUST validate, atomically within the same `$transaction` as the money/stock-affecting write, that the target cash register is still `status: 'OPEN'`, for every operation that binds to a register: `salesServices.create` (at the stock-decrement write), `movimientosServices.createMovement`, and `currentAccountServices.registerPayment` (cash payments). An operation racing a close MUST either land before the close completes (counted in the close's `expectedAmount`) or be rejected with `status === 409` (excluded from `expectedAmount`) — it MUST NOT both take effect (customer charged, movement recorded, payment recorded) and be excluded from the close's totals.

#### Scenario: Sale committed in the close window

- GIVEN a register being closed concurrently with an in-flight sale submission
- WHEN both operations race
- THEN the sale MUST either complete and be counted in `expectedAmount`, or be rejected with `status === 409`
- AND no `order` row MUST exist whose `cashRegisterId` points to a register with `closedAt` earlier than the order's `createdAt`

#### Scenario: Manual movement or cash CC payment committed in the close window

- GIVEN a register being closed concurrently with an in-flight `createMovement` or cash `registerPayment` request
- WHEN both operations race
- THEN the movement/payment MUST either complete and be counted in `expectedAmount`, or be rejected with `status === 409`
- AND it MUST NOT be recorded while excluded from the close's totals

#### Scenario: Balanced drawer under concurrent sale traffic

- GIVEN a drawer whose physical cash matches all sales completed before its close
- WHEN the close executes while sale traffic is concurrently hitting the register
- THEN the reported `difference` MUST equal `0`

### Requirement: Exactly-Once Register Open Per Store

The system MUST enforce, via a partial unique database index on `CashRegister (storeId) WHERE status = 'OPEN'`, that at most one `OPEN` register exists per store at any time. The application layer MUST translate a violation of this constraint into a `409` response naming the cause, never an unhandled `500`.

#### Scenario: Two terminals race to open the same store's register

- GIVEN a store with no `OPEN` register
- WHEN two `openRegister` requests for that store are submitted concurrently from different terminals
- THEN exactly one request MUST succeed
- AND the other MUST be rejected with `status === 409`
- AND at no point MUST two `OPEN` registers exist for the same store

### Requirement: Rejection Copy and Recovery Action

Every `409` rejection caused by a stale or closed register binding (sale, manual movement, cash CC payment, or register open) MUST surface the agreed user-facing message — "La caja se cerró mientras confirmabas la venta. Abrí la caja de nuevo para continuar." adapted per action — paired with a button that navigates directly to opening a register, not a raw error string or generic alert.

#### Scenario: Sale rejected by a mid-confirmation close

- GIVEN a sale submission rejected with `status === 409` because the bound register closed mid-flight
- WHEN the rejection reaches the POS UI
- THEN the displayed message MUST be the agreed copy, worded for the sale action
- AND a button MUST be shown that navigates directly to opening a new register
