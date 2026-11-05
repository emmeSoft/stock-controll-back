# Cash Change Handling Specification

## Purpose

This spec ensures that a sale with a cash leg records what the customer handed over (`receivedAmount`), what was applied to the sale (`amount`, net), and what was returned (`changeAmount`) — mandatory per cash leg, rejected when insufficient, computed server-side, never carrying a surplus into the drawer's expected totals.

## Requirements

### Requirement: Mandatory Received Amount Per Cash Leg

Every `paymentBreakdown` entry whose method normalizes (case-insensitive) to `efectivo` MUST carry a `receivedAmount`. A missing, non-numeric, non-finite, or non-positive `receivedAmount` MUST be rejected with `status === 400` and `code: 'CASH_RECEIVED_REQUIRED'`, validated before any Decimal arithmetic or transaction opens. A cash payment toward a `CurrentAccount` balance (`currentAccountServices.registerPayment`) is NOT required to carry a `receivedAmount` — this requirement applies to Nueva Venta only.

#### Scenario: Missing receivedAmount on a cash leg

- GIVEN a `paymentBreakdown` entry with method "Efectivo" and no `receivedAmount`
- WHEN the sale is submitted
- THEN the request MUST be rejected with `status === 400` and `code === 'CASH_RECEIVED_REQUIRED'`
- AND no transaction MUST be opened

#### Scenario: Non-numeric or non-positive receivedAmount rejected

- GIVEN a cash leg with `receivedAmount` of `0`, a negative value, `NaN`, or a non-numeric type
- WHEN the sale is submitted
- THEN the request MUST be rejected with `status === 400` and `code === 'CASH_RECEIVED_REQUIRED'`

#### Scenario: CurrentAccount cash payment does not require receivedAmount

- GIVEN a cash payment registered against a client's `CurrentAccount` balance via `registerPayment`
- WHEN the payment is submitted without a `receivedAmount`
- THEN the payment MUST be accepted exactly as before this change

### Requirement: Zero-Tolerance Insufficient Received Amount

A cash leg's `receivedAmount` MUST be greater than or equal to that leg's `amount`, with zero tolerance — no float or rounding margin. `receivedAmount < amount` MUST be rejected with `status === 400`, `code: 'CASH_RECEIVED_INSUFFICIENT'`, and a message naming both figures. This comparison is independent of, and self-contained from, any general payment-sufficiency tolerance used elsewhere for `validatePayments`'s total-paid check.

#### Scenario: receivedAmount equal to amount passes

- GIVEN a cash leg with `amount === 100.00` and `receivedAmount === 100.00`
- WHEN the sale is submitted
- THEN the cash leg MUST be accepted
- AND `changeAmount` MUST equal `0`

#### Scenario: receivedAmount one cent under amount is rejected

- GIVEN a cash leg with `amount === 100.00` and `receivedAmount === 99.99`
- WHEN the sale is submitted
- THEN the request MUST be rejected with `status === 400` and `code === 'CASH_RECEIVED_INSUFFICIENT'`
- AND the error message MUST name both `99.99` and `100.00`

### Requirement: Change Computation and Net Persistence

`changeAmount` MUST be computed as `round(receivedAmount − amount)` using `utils/money.js` (HALF_UP, 2dp). `OrderPayment.amount` for a cash leg MUST remain the NET amount applied to the sale — never the gross `receivedAmount`. `receivedAmount` and `changeAmount` MUST be persisted on the cash `OrderPayment` row. `Σ paymentBreakdown.amount === order.amount` MUST hold regardless of any overpayment.

#### Scenario: Overpaid cash sale persists net amount and change

- GIVEN a sale with total `100.00` paid with a cash leg of `receivedAmount === 150.00`
- WHEN the sale is created
- THEN `OrderPayment.amount` MUST equal `100.00`
- AND `OrderPayment.receivedAmount` MUST equal `150.00`
- AND `OrderPayment.changeAmount` MUST equal `50.00`
- AND `Σ paymentBreakdown.amount` MUST equal `order.amount`

#### Scenario: Pre-existing orders render unaffected

- GIVEN an order created before this change, with `receivedAmount` and `changeAmount` both `NULL`
- WHEN that order is read or rendered
- THEN it MUST behave exactly as it did before this change, with no backfill or repair applied

#### Scenario: Entering a received amount does not change payment-method discounts

- GIVEN a sale whose payment-method discount is computed from a cash leg's net `amount`
- WHEN a `receivedAmount` greater than that leg's `amount` is entered
- THEN the computed discount MUST be byte-identical to the discount computed with no `receivedAmount` entered

### Requirement: Change Surfaced in Response and Shift-Level Arqueo

The sale-create response MUST carry the server-computed `change`. Per-sale received/change MUST be exposed wherever sale payment breakdowns are listed (`getRegisterHistory`, `getAllRegisters`, `getGlobalHistory`). A shift-level "vueltos entregados" total, derived from the register's non-cancelled orders, MUST be exposed only where the view represents a single shift/register (`getRegisterHistory`, `getAllRegisters`) — NOT for `getGlobalHistory`'s date-ranged aggregate, which is out of scope for this slice.

#### Scenario: Sale response includes server-computed change

- GIVEN a cash sale with `receivedAmount` exceeding its leg's `amount`
- WHEN the sale-create response is returned
- THEN it MUST include a `change` field equal to the persisted `changeAmount`

#### Scenario: Shift arqueo shows vueltos entregados excluding cancelled sales

- GIVEN a shift containing two overpaid cash sales, one of which is later cancelled
- WHEN `getRegisterHistory` or `getAllRegisters` computes the shift's "vueltos entregados" total
- THEN the total MUST include only the non-cancelled sale's change
- AND it MUST never be counted twice against the drawer

### Requirement: Non-Cash Legs Ignore receivedAmount

A `receivedAmount` sent on a `paymentBreakdown` entry whose method does not normalize to `efectivo` (Tarjeta, Transferencia, Cuenta Corriente) MUST be ignored silently — it MUST NOT be validated, persisted, or treated as an error.

#### Scenario: receivedAmount sent on a non-cash leg is ignored

- GIVEN a `paymentBreakdown` entry with method "Tarjeta" and a `receivedAmount` value attached
- WHEN the sale is submitted
- THEN the sale MUST be accepted as if no `receivedAmount` had been sent
- AND no `receivedAmount`/`changeAmount` MUST be persisted for that leg

### Requirement: Change Computed on the Cash Leg in Mixed Splits

In a split payment containing a cash leg and one or more non-cash legs (card, Cuenta Corriente), change MUST be computed against the cash leg's `receivedAmount` and `amount` only.

#### Scenario: Split cash + card sale computes change on the cash leg only

- GIVEN a sale split between a cash leg and a card leg
- WHEN the cash leg is overpaid
- THEN `changeAmount` MUST be computed solely from the cash leg's `receivedAmount` and `amount`
- AND the card leg MUST be unaffected

#### Scenario: Split cash + cuenta corriente sale computes change on the cash leg only

- GIVEN a sale split between a cash leg and a Cuenta Corriente leg
- WHEN the cash leg is overpaid
- THEN `changeAmount` MUST be computed solely from the cash leg's `receivedAmount` and `amount`
- AND the Cuenta Corriente leg's debt MUST be unaffected

### Requirement: Mandatory-but-Quick-Fill-Satisfies Cash Input

The POS payment step MUST require a valid `receivedAmount` for every cash leg before the sale can be confirmed. A one-tap "exact amount" quick-fill, prefilled with that leg's `amount`, MUST count as a valid `receivedAmount` entry — no typed figure is required for an exact-cash sale.

#### Scenario: Confirm is blocked until every cash leg has a valid receivedAmount

- GIVEN a sale with one or more cash legs and no `receivedAmount` entered on at least one of them
- WHEN the cashier attempts to confirm the sale
- THEN the confirm action MUST be blocked

#### Scenario: One-tap quick-fill satisfies the mandatory input

- GIVEN a cash leg with no `receivedAmount` typed
- WHEN the cashier taps the "exact amount" quick-fill
- THEN `receivedAmount` MUST be set to that leg's `amount`
- AND the confirm action MUST become available with no further typing required

### Requirement: Received and Change Visible on Sale Displays

The sale ticket and any payment-breakdown display MUST show received and change amounts for a cash leg that had a `changeAmount` greater than `0`.

#### Scenario: Ticket shows received and change for an overpaid cash sale

- GIVEN a sale whose cash leg had `changeAmount > 0`
- WHEN the sale ticket is rendered
- THEN it MUST display the received amount and the change amount for that leg

#### Scenario: Exact-cash sale ticket shows no change line

- GIVEN a sale whose cash leg had `changeAmount === 0`
- WHEN the sale ticket is rendered
- THEN it MUST NOT display a change line for that leg
