# Proposal: Cash Change Calculation (Vuelto)

## Intent

The system has **no concept of change given back**. There is no "amount received" input anywhere in the POS, for any cash payment, and no field to store one. When a customer hands over more cash than the sale total, that surplus has nowhere to go — so it either disappears from the record or leaks into a field that means something else.

Why this is a money bug and not a missing nicety (confirmed by reading the current code):

- `cajaServices.closeRegister` computes `expectedAmount` as `openingAmount + Σ OrderPayment.amount (paymentMethod ≈ 'efectivo') + Σ INCOME − Σ EXPENSE` (`cajaServices.js:171-195`). The expected cash in the drawer is driven **directly by `OrderPayment.amount`**.
- `validatePayments` (`salesServices.js:33-56`) only checks that payments are *sufficient*: `if (totalPaid.lt(total.minus(tolerance))) throw`. Overpayment is accepted silently and documented as such — *"Si el cliente paga de más, se asume que es vuelto o excedente contable. (SC-3.4)"*. The same one-sided check exists for the non-CC leg at `salesServices.js:394-401`.
- Consequence: **any** path that lands a received amount (rather than the net amount applied to the sale) in a cash `OrderPayment.amount` inflates `expectedAmount` by exactly the change that physically left the drawer, with no offsetting outflow. The close then reports a false negative `difference` on a drawer that is physically correct — and the cashier has no way to explain it. This matches the production incident reported by the product owner.

There is also an unapplied, overlapping change folder: `openspec/changes/fix-split-payment-verification` (all tasks unchecked). Its `validatePayments` relaxation (T1) **is already in the code**; its change-handling half (T2: "añadir campo `change`", "restar la diferencia del primer EFECTIVO") was never implemented. That folder is superseded by this one — see Open Questions #4.

**Why now**: this is a daily, irreversible, money-bearing flow. Level 1 (`money-stock-integrity`) made the arithmetic exact and Level 2 (`caja-close-integrity`) made the close exactly-once and race-free — both invested in making `expectedAmount` trustworthy. A missing change concept re-breaks that same number from the input side, and does it on ordinary non-concurrent sales.

## Scope

### In Scope — Backend (`stock-controll-back`)

1. **Mandatory `receivedAmount` per cash leg.** Every `paymentBreakdown` entry whose method normalizes to `efectivo` MUST carry a `receivedAmount`. Missing, non-numeric, non-finite, or non-positive → rejected `400` with the house `{ status, code }` convention, validated in `validatePaymentBreakdownAmounts` (`discountEngine/universal.js`, already called at `salesServices.js:103`) **before** any Decimal arithmetic — same rationale as the existing early guard: a malformed amount must not surface as a `[DecimalError]` from inside the transaction.
2. **Insufficient received = hard block.** `receivedAmount < amount` for that cash leg → rejected with a clear message naming both numbers. Never accepted as an implicit shortfall. Tolerance treatment is deliberately stricter than `validatePayments` — see Open Questions #1.
3. **Change computed and persisted, never inferred by the client.** `changeAmount = round(receivedAmount − amount)` using `utils/money.js` (`money()` to construct, `round()` = HALF_UP @ 2dp — the same single arithmetic entry point as Level 1). Persisted on the cash `OrderPayment` row alongside `receivedAmount`.
4. **`OrderPayment.amount` stays NET** — the amount that cash leg applies to the sale, never the gross received. This is the invariant that makes the incident unreachable, and it keeps `Σ paymentBreakdown == order.amount`, which `validatePayments`, `getAllRegisters`' `ventasEfectivo` bucket, and the discount engine's `baseAmount` weighting all already assume.
5. **Close arithmetic unchanged, deliberately.** Because the cash leg is net, `expectedAmount` is correct with no new term and no new `CashMovement`. This is asserted by a test, not assumed — the non-change is a deliverable.
6. **Change surfaced in caja/arqueo reporting** as its own labeled, explicitly non-arithmetic line: per-sale (received / change) plus a shift-level "vueltos entregados" total derived from the register's non-cancelled orders, exposed by `getRegisterHistory` / `getAllRegisters` / `getGlobalHistory`.
7. **`change` in the sale-create response** so the POS displays what to hand back from the server's number, not its own.

### In Scope — Frontend (`stock-controll-main`)

8. **"Monto recibido" input in the payment step** (`DiscountSummaryModal.jsx` — the actual payment entry point, both single-method and split mode), with live change display, an "exact amount" quick-fill, and confirm blocked until every cash leg is valid.
9. **Breakdown entry shape** gains `receivedAmount` (`posStore.js` `addPayment` / `updatePayment`), forwarded by `NewSale.jsx`'s `processSale`.
10. **Change visible in the arqueo and reports** (`CashRegister.jsx` shift view, `RegisterHistory.jsx` per-register totals) as a labeled informational line — the physical-cash formulas (`fisico`, `fisicoExpected`) stay untouched.
11. **Received / change on the ticket** (`SaleDetail.jsx:275-290`, where the breakdown already renders).

### Out of Scope

- **Cash payments toward a `CurrentAccount` balance** (`currentAccountServices.registerPayment`, `RegisterPaymentModal.jsx`) — explicit product-owner decision for this slice. Nueva Venta only.
- **Non-cash methods** (Tarjeta, Transferencia, Cuenta Corriente): no `receivedAmount`, no change. Sending one for a non-cash leg is ignored, not an error (see Open Questions #3).
- **The `validatePayments` tolerance value itself** — out of scope in both prior levels; stays out here. This change adds its own stricter rule for the received-vs-leg comparison instead of touching it.
- **Retrofitting historical orders.** New columns are nullable; pre-existing rows keep `NULL` received/change and render as they do today. No data repair of the reported incident (see Rollback Plan).
- **A `MovementType.CHANGE_GIVEN` enum value** and any change to `CashMovement` — rejected, see Approach.
- Multi-currency, denomination/bill breakdown ("¿con cuánto me paga?" presets beyond the quick-fill), cash-drawer hardware.

## Capabilities

### New Capabilities
- `cash-change-handling`: a sale with a cash leg records what the customer handed over, what was applied to the sale, and what was returned; the amount received is mandatory, an insufficient amount is rejected, and change is computed server-side.

### Modified Capabilities
- `cash-register-integrity`: the "Balanced drawer" requirement gains a clause — a drawer stays balanced when a cash payment exceeds the sale total, because a cash `OrderPayment.amount` is the net amount applied to the sale and can never carry a received-amount surplus.

## Approach (recommended decisions)

The central coupling: `expectedAmount` is driven by cash `OrderPayment.amount`, so **how the cash leg is recorded and whether change is a ledger entry must be decided together** — getting it half-right double-counts. Two coherent packages exist.

| Decision | Chosen | Rejected |
|---|---|---|
| Cash leg semantics | **Net** — `OrderPayment.amount` = amount applied to the sale; `receivedAmount` / `changeAmount` stored beside it as audit fields | **Gross** — store received in `amount` and offset with a change `CashMovement(EXPENSE)`. Nets correctly for the close, but (a) skews `DiscountSummaryModal.jsx:156-166`'s proportional `baseAmount` split, which the backend evaluator uses for payment-method discounts → wrong discounts; (b) turns `getAllRegisters.ventasEfectivo` into gross cash, breaking revenue-by-method reporting; (c) makes `Σ breakdown > order.amount` structurally normal, permanently disarming the only guard that would catch a real manipulation |
| Where change lives | Two nullable columns on `OrderPayment` (`receivedAmount`, `changeAmount`, `Decimal(12,2)`) — per cash leg, works for split payments, additive migration | Order-level single column (breaks for two cash legs); free-text `reference` magic string (unparseable, unqueryable); a new table (no second consumer) |
| Change as a cash movement | **No `CashMovement`.** The drawer never kept the change, so expected cash is already right; a movement that must be excluded from the `EXPENSE` sum to avoid double-subtraction is a lie in the ledger and forces `closeRegister` math to change | New `MovementType.CHANGE_GIVEN`: Postgres `ALTER TYPE` migration, plus `closeRegister`'s `expense` filter, `getAllRegisters`' buckets, and 5+ binary `type === 'INCOME' ? … : …` frontend branches (`CashRegister.jsx:231,601,635,801`, `RegisterHistory.jsx:371`, `SalesHistory.jsx`, `SalesList.jsx`) must each be widened — miss one and close arithmetic silently breaks, which is the exact bug class this change exists to kill |
| Arqueo visibility (requirement #3) | Derived, labeled, non-arithmetic: per-sale received/change + a shift "vueltos entregados" total computed from the register's non-cancelled orders | Reusing `CashMovement(EXPENSE)` with a discriminator — it would land in `retirosManuales` and render as "EGRESO/Retiro Manual" everywhere, mislabeling change as a withdrawal |
| Cash-leg detection | Case-insensitive normalized compare (`method.toLowerCase() === 'efectivo'`), matching `cajaServices.js:175`. The frontend sends `"Efectivo"` (`DiscountSummaryModal.jsx:12`) and `salesServices.create` only normalizes `"Cuenta Corriente"` (`salesServices.js:120-125`) — a strict `=== 'EFECTIVO'` check would silently match **zero** real sales and make the mandatory rule a no-op | Strict uppercase equality; a method-enum refactor (wider blast radius, own change) |
| Rounding | `round()` from `utils/money.js` (HALF_UP, 2dp); `money()` to construct; no native `+ − <` on money | Local rounding; `toFixed` |
| Error contract | `Object.assign(new Error(msg), { status: 400, code: 'CASH_RECEIVED_REQUIRED' \| 'CASH_RECEIVED_INSUFFICIENT' })` — controllers already forward `error.status` | New error class; message substring matching in the frontend |
| Validation placement | Shape/presence in `validatePaymentBreakdownAmounts` (pre-transaction); sufficiency per leg where the leg amounts are final, next to `validatePayments` | Validating only inside the transaction (leaks `DecimalError`); frontend-only validation |
| Tests | House style: plain `node`, local `assert`, registered in `tests/run-all.js` | A test framework |

## Success Criteria

- [x] A Nueva Venta containing a cash leg without `receivedAmount` is rejected with `status === 400` and a `code`, before any transaction opens.
- [x] A cash leg with `receivedAmount` below that leg's amount is rejected with a message naming both figures — never recorded as a partial shortfall.
- [x] A cash leg with `receivedAmount` above its amount persists `receivedAmount`, `changeAmount = round(received − amount)`, and `amount` = the **net** amount applied to the sale; `Σ paymentBreakdown.amount === order.amount` still holds.
- [x] The sale-create response carries the server-computed `change`, and the POS displays that value rather than recomputing it.
- [x] A shift of cash sales that were all overpaid, with every change handed back, closes with `difference === 0` and an `expectedAmount` equal to opening + net cash sales — reproducing the reported incident as a passing test.
- [x] `closeRegister`'s `expectedAmount` formula is unchanged, and no `CashMovement` row is created by a sale.
- [x] The arqueo shows change as its own labeled entry per sale plus a shift "vueltos entregados" total, excluding cancelled sales, and never counted twice against the drawer.
- [x] Exact-cash sales (the common case) are confirmable in one tap via the quick-fill, with no typed figure required.
- [x] A split cash + card sale and a split cash + cuenta corriente sale both compute change against the **cash leg only**.
- [x] Payment-method discounts are byte-identical before and after a received amount is entered (`baseAmount` unaffected).
- [x] `tests/run-all.js` exits 0 with both new scripts registered, and the Level 1 / Level 2 suites still pass.
