# Tasks: Cash Change Calculation (Vuelto) — Level 3

## Pre-Apply Step (mandatory, before Unit A)

- [ ] 0.1 Rebase/update `sdd/cash-change-calculation-proposal` from `main`. Design confirmed the sibling `$0.50` tolerance cap (PR #35) is **NOT yet merged to `main`** as of 2026-11-04 — `salesServices.js:46,374,222` still has the uncapped `0.1%` formula on this branch. Do not re-derive or work around the uncapped formula; just update from `main` so Units B/D build on real current state. If PR #35 still isn't merged after rebase, proceed anyway — this change's `receivedAmount` check is zero-tolerance and self-contained, independent of that cap (Open Question #1).

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~950–1,150 (backend ~550–650 across Units A–D, frontend ~350–400 across Units E–F) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (A) → PR 2 (B) → PR 3 (C) → PR 4 (D); PR 5 (E) may start parallel to A–D; PR 6 (F) depends on C+B |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending — see flag below |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

**Chain strategy flag**: no hard same-deploy coupling forces `feature-branch-chain` *within* the backend (A→B→C→D are reviewable independently, same as Level 1/2). The one real coupling is cross-repo: `getRegisterHistory`'s shape change (Unit C) and its one consumer, `CashRegister.jsx:126` (Unit F), must be verified and deployed together — see Sequencing Notes. `stacked-to-main` is viable for A–E; F must not merge/deploy ahead of or long after C. Orchestrator must pick explicitly.

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| A | Schema + additive migration (`receivedAmount`, `changeAmount` on `OrderPayment`) | PR 1 | Foundation. ~30–50 lines (mostly generated SQL) |
| B | `salesServices.js`: predicate, shape validator, sufficiency+change math, PASO 8 persistence, response contract | PR 2 | Depends on PR 1. ~150–200 lines |
| C | `cajaServices.js` reporting (`getRegisterHistory`→`{items,totals}`, `getAllRegisters`) + `cajaController.js` Excel column | PR 3 | Depends on PR 1; needs PR 2 merged for meaningful integration tests. ~70–100 lines |
| D | 2 new test files + 6 regression fixture updates + `run-all.js` | PR 4 | Depends on PR 1–3. ~350–450 lines |
| E | `DiscountSummaryModal.jsx` input/quick-fill/gate | PR 5 | No backend dependency to *write*; may start parallel to A–D. Full confirm-gate verification needs backend deployed. ~150–220 lines |
| F | `SaleDetail.jsx`, `CashRegister.jsx`, `RegisterHistory.jsx`, `NewSale.jsx` (minimal) | PR 6 | Depends on B (response fields) and **C** (`.items`/`.totals` shape) — see coupling flag. ~150–200 lines |

## Phase 1: Unit A — Schema + Migration

- [x] 1.1 `prisma/schema.prisma`: add `OrderPayment.receivedAmount Decimal? @db.Decimal(12,2)` and `changeAmount Decimal? @db.Decimal(12,2)` (nullable, no default).
- [x] 1.2 Run `npx prisma migrate dev --name order_payment_cash_change` — generated migration, do NOT hand-write (unlike Levels 1/2; these columns are inside Prisma's PSL surface).
- [x] 1.3 Confirm pre-existing `OrderPayment` rows read back with `NULL` for both columns, no backfill.

## Phase 2: Unit B — Validation, Change Math, Persistence

- [x] 2.1 `services/salesServices.js`: add `const isCashMethod = (method) => String(method ?? '').trim().toLowerCase() === 'efectivo'` beside `validatePayments`. Do NOT add `"Efectivo"` to the existing `"Cuenta Corriente"` normalization block (design Decision 2 — would split historical ticket spellings for no gain).
- [x] 2.2 Add `validateCashReceivedShape(paymentBreakdown)`, called pre-transaction right after the normalization block (~`:113`): non-cash legs skipped; cash leg with `!isPositiveAmount(receivedAmount)` → `400 { code: 'CASH_RECEIVED_REQUIRED' }`.
- [x] 2.3 Inside the transaction, immediately after `validatePayments`/non-CC branch (~`:366-382`): per cash leg, `received.lt(legAmount)` → `400 { code: 'CASH_RECEIVED_INSUFFICIENT' }` naming both figures, zero tolerance; else `leg._changeAmount = round(received.minus(legAmount))`.
- [x] 2.4 PASO 8 (`orderPayment.create`, ~`:422-431`): persist `amount` NET unchanged; `receivedAmount`/`changeAmount` = computed values for cash legs, `null` for non-cash (even if a `receivedAmount` was sent — ignored silently, never persisted).
- [x] 2.5 Response (~`:570-586`): add `change: totalChange` (sum of per-leg `_changeAmount`); enrich returned `orderPayments` with `receivedAmount`/`changeAmount` for cash legs, strip internal `_changeAmount`.
- [x] 2.6 Confirm `Σ paymentBreakdown.amount === order.amount` still holds regardless of overpayment (no code change expected — assert in Unit D).

## Phase 3: Unit C — Reporting + Excel Export

- [x] 3.1 `services/cajaServices.js` `getAllRegisters` (~`:327`): add `totals.vueltosEntregados` from `reg.orders` (already filtered non-cancelled) — comment that no extra filter is needed.
- [x] 3.2 `services/cajaServices.js` `getRegisterHistory` (~`:254`): change return shape to `{ items, totals: { vueltosEntregados } }`; `vueltosEntregados` applies its OWN explicit non-cancelled filter (`orders` here deliberately includes CANCELLED for audit — do not inherit that default for the money aggregate).
- [x] 3.3 **Cross-repo coupling — do not merge/deploy ahead of Unit F's 6.4**: this is a breaking contract change for `GET /api/caja/history`'s one known consumer, `CashRegister.jsx:126`. Verify 6.4 against this shape change before either side's PR is considered mergeable. (Code side implemented in this unit; the cross-repo pairing verification against Unit F's 6.4 itself cannot be completed until Unit F exists — see apply report flag.)
- [x] 3.4 `controllers/cajaController.js` `exportRegisters`: add `vueltos: toNumber(t.vueltosEntregados)` data cell + matching Excel column header; `fisicoExpected` untouched.
- [x] 3.5 Confirm `closeRegister` (~`:159-196`) formula is untouched — no code change here; asserted by Unit D's new integrity test, not by inspection alone.

## Phase 4: Unit D — Tests (New Files + Regression Fixtures)

- [x] 4.1 Write `tests/scenarios/cash-change.test.js`: missing/non-numeric/zero/negative `receivedAmount` → `400 CASH_RECEIVED_REQUIRED`, zero `order` rows; insufficient → `400 CASH_RECEIVED_INSUFFICIENT` naming both figures; exact match → `changeAmount === 0`; overpayment → net `amount`/`receivedAmount`/`changeAmount`/`Σ === order.amount`; response `change`; split cash+tarjeta and cash+CUENTA_CORRIENTE compute change on the cash leg only; literal `"Efectivo"` string detected as cash; non-cash leg's `receivedAmount` ignored, both columns `NULL`; discount parity with/without `receivedAmount`. **Added after a code review caught it in Unit B**: a float-precision case — `receivedAmount: 19.999999999999996` against a `legAmount` of exactly `20` must NOT throw `CASH_RECEIVED_INSUFFICIENT` (both are `round()`ed to 2dp before the zero-tolerance comparison, fixed in the same Unit B commit history); and the response's `receivedAmount` must come back as a clean 2-decimal value even when the client sent extra float precision (it's persisted/returned via the rounded `_receivedAmount`, not the raw client value — same fix). 9 scenarios, all passing. Discount-parity scenario uses its own isolated store + an ORDER_LEVEL discount rule gated on `ticketConditions.paymentMethods: ['Efectivo']`, comparing an exact-cash sale vs. an overpaid one (both valid, since `receivedAmount` is now mandatory on every cash leg — a literal "no receivedAmount at all" comparison is no longer constructible via `create()`); confirms `discountTotal`/`appliedDiscounts` are byte-identical regardless of the surplus.
- [x] 4.2 Write `tests/integrity/caja-expected-with-change.test.js`: shift of N overpaid cash sales → `expectedAmount === opening + Σ net cash`, `difference === 0`; zero `CashMovement` rows created; `getRegisterHistory().totals.vueltosEntregados` / `getAllRegisters()[0].totals.vueltosEntregados` equal `Σ changeAmount` excluding a cancelled overpaid sale in the same shift. All assertions pass.
- [x] 4.3 Register both scripts in `tests/run-all.js` (`./integrity/caja-expected-with-change.test.js` after `./integrity/caja-open-index.test.js`; `./scenarios/cash-change.test.js` after `./scenarios/movement-validation.test.js`/concurrency group, before the discountEngine group).
- [x] 4.4 **Update regression fixtures to supply `receivedAmount` on every cash leg**. Of the 6 listed, only 3 actually construct a cash leg through `salesServices.create()` and needed a change: `tests/scenarios/cancel-reverses-debt.test.js` (CASO 2), `tests/concurrency/sale-race.test.js`, `tests/concurrency/sale-vs-caja-close-race.test.js`. The other 3 — `tests/scenarios/cc-exact-payment.test.js` (only calls `currentAccountServices.registerPayment`, explicitly exempt per spec), `tests/scenarios/movement-validation.test.js` (only calls `movimientosServices.createMovement`/`cajaServices.closeRegister`, never `salesServices.create`), `tests/concurrency/caja-close-race.test.js` (only calls `cajaServices.closeRegister`) — never construct a cash leg at all and needed no change; confirmed by reading each file before touching anything. Assertions unchanged in all 3 modified files. `movement-validation.test.js`'s exact `expectedAmount === 1445.44` / `difference === 0` checks pass byte-identical (unmodified file, unmodified result) — confirms `closeRegister` is untouched.
- [x] 4.5 Full `node tests/run-all.js` green, zero regressions. 24/24 scripts passed (22 pre-existing + 2 new) — corrected at verify time, an earlier note here mis-stated 28/28.

## Phase 5: Unit E — Frontend Input/Quick-Fill/Gate

Implemented in `stock-controll-main` (separate repo), PR #6 (`cash-change-calculation-e-frontend-input`, merged). Checkboxes below were left unticked during apply because the work landed in the other repo's git history, not this one — ticked now at verify time after confirming each item directly against the merged `DiscountSummaryModal.jsx`.

- [x] 5.1 `DiscountSummaryModal.jsx` single mode: add `singleReceived` state; quick-fill prefills from **`finalTotal`, never `productsTotal`** (`productsTotal` is gross and ignores discounts — prefilling it would show an inflated/wrong change on any discounted sale); gate = `isCashMethod(singleMethod) ⇒ parseFloat(singleReceived) >= finalTotal`.
- [x] 5.2 Split mode: add `receivedAmount` per `splitBreakdown` entry; per-leg quick-fill from `p.amount`; gate = every cash leg `receivedAmount >= amount`.
- [x] 5.3 Fix `handleUpdatePayment` (~line 139-141) to spread-preserve existing fields — `{ ...p, method, amount }`, not `{ method, amount }`. Without this, `receivedAmount` is silently destroyed on any split-amount edit.
- [x] 5.4 Live "Vuelto" display per cash leg: `Math.max(0, received - amount)`, informational only — server's `change` is authoritative.
- [x] 5.5 Key the debounced `onPaymentChange` preview effect on a projected `{method, amount}`-only signature (not the full entry) so entering `receivedAmount` does not re-trigger the discount preview; confirm discount parity.
- [x] 5.6 Confirm action disabled while any cash leg is invalid, alongside existing `!isCovered`/`isProcessing` conditions; `handleConfirm`'s `baseAmount` weighting keeps deriving from net `amount`, untouched.

## Phase 6: Unit F — Ticket + Arqueo Display

- [x] 6.1 `SaleDetail.jsx` (~273-291): render received/change in BOTH the multi-leg `.map` branch and the single-leg fallback branch; change line only when `changeAmount > 0`. Real locations confirmed: multi-leg map at lines 275-281 (restructured from inline comma-joined spans to a `flex flex-col` list so each leg can carry an optional "Recibido/Vuelto" sub-line), single-leg fallback at lines 282-290. Both gated on `p.changeAmount > 0`.
- [x] 6.2 `NewSale.jsx`: no forwarding code change needed (`finalBreakdown` already carries `receivedAmount`; `response.data` already carries `change`) — confirmed by reading `processSale` (lines 325-373): `paymentBreakdown: finalBreakdown` forwarded verbatim (line 331), `setCurrentSale({ ...response.data, items: cart })` (line 350) carries the full response. Added a documenting comment only, no logic change.
- [x] 6.3 `pages/Reportes/RegisterHistory.jsx`: add "Vueltos entregados" row from `t.vueltosEntregados` (confirmed this component calls `/api/caja/registers` → `getAllRegisters`, NOT `getRegisterHistory` — different function/shape as flagged in the task). Row added in the CAJA FÍSICA block between "Retiros/Gastos" and the `fisicoExpected` border-top section, guarded `(t.vueltosEntregados ?? 0) > 0`. `fisicoExpected` (line 173, unchanged formula) untouched.
- [x] 6.4 `CashRegister.jsx` (real line was 126-127 as cited, confirmed): updated `fetchData` to `setHistory(histRes.data.items ?? [])` + new `shiftTotals` state holding `histRes.data.totals ?? null` (cleared to `null` in the no-register branch too). Rendered an informational "Vueltos entregados" row in the REAL-TIME TOTALS FOOTER (wrapped the existing `grid grid-cols-3` div in a `flex flex-col` container and added a sibling row below it — the grid's internal content/logic is untouched) plus per-leg "Vuelto" sub-lines in both the combined-order sub-item rows and the simple-order row of the activity history list. `getOrderTotals` / `fisico` math confirmed byte-identical at both sites (handleCloseInitial ~line 231, footer IIFE ~line 809) — see apply report for before/after line quotes.
- [x] 6.5 Confirmed `posStore.js` is NOT modified — not read or touched in this unit; `addPayment`/`updatePayment`/`removePayment` remain dead code for this flow (also flagged by `npx eslint` as unused in `NewSale.jsx`, consistent with the design doc's Corrections table).

## Sequencing Notes

- Backend-first rollout: deploy A→D before E/F per design Rollout — a stale frontend tab gets a visible, recoverable `400 CASH_RECEIVED_REQUIRED`, never a silent inflated drawer; the reverse (strict backend + old frontend) is not acceptable and must not happen.
- Cross-repo coupling (Unit C.3.3 ↔ Unit F.6.4): `getRegisterHistory`'s `{items, totals}` shape change and its one consumer must be verified together — do not let one land on `main` while the other is still pending.
- `posStore.js`: confirmed no task modifies it (6.5).
- Rebase note (0.1) is a pre-apply git operation, not a reviewable code task — do not fold it into any unit's diff.
