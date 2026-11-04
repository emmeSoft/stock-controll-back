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

- [ ] 2.1 `services/salesServices.js`: add `const isCashMethod = (method) => String(method ?? '').trim().toLowerCase() === 'efectivo'` beside `validatePayments`. Do NOT add `"Efectivo"` to the existing `"Cuenta Corriente"` normalization block (design Decision 2 — would split historical ticket spellings for no gain).
- [ ] 2.2 Add `validateCashReceivedShape(paymentBreakdown)`, called pre-transaction right after the normalization block (~`:113`): non-cash legs skipped; cash leg with `!isPositiveAmount(receivedAmount)` → `400 { code: 'CASH_RECEIVED_REQUIRED' }`.
- [ ] 2.3 Inside the transaction, immediately after `validatePayments`/non-CC branch (~`:366-382`): per cash leg, `received.lt(legAmount)` → `400 { code: 'CASH_RECEIVED_INSUFFICIENT' }` naming both figures, zero tolerance; else `leg._changeAmount = round(received.minus(legAmount))`.
- [ ] 2.4 PASO 8 (`orderPayment.create`, ~`:422-431`): persist `amount` NET unchanged; `receivedAmount`/`changeAmount` = computed values for cash legs, `null` for non-cash (even if a `receivedAmount` was sent — ignored silently, never persisted).
- [ ] 2.5 Response (~`:570-586`): add `change: totalChange` (sum of per-leg `_changeAmount`); enrich returned `orderPayments` with `receivedAmount`/`changeAmount` for cash legs, strip internal `_changeAmount`.
- [ ] 2.6 Confirm `Σ paymentBreakdown.amount === order.amount` still holds regardless of overpayment (no code change expected — assert in Unit D).

## Phase 3: Unit C — Reporting + Excel Export

- [ ] 3.1 `services/cajaServices.js` `getAllRegisters` (~`:327`): add `totals.vueltosEntregados` from `reg.orders` (already filtered non-cancelled) — comment that no extra filter is needed.
- [ ] 3.2 `services/cajaServices.js` `getRegisterHistory` (~`:254`): change return shape to `{ items, totals: { vueltosEntregados } }`; `vueltosEntregados` applies its OWN explicit non-cancelled filter (`orders` here deliberately includes CANCELLED for audit — do not inherit that default for the money aggregate).
- [ ] 3.3 **Cross-repo coupling — do not merge/deploy ahead of Unit F's 6.4**: this is a breaking contract change for `GET /api/caja/history`'s one known consumer, `CashRegister.jsx:126`. Verify 6.4 against this shape change before either side's PR is considered mergeable.
- [ ] 3.4 `controllers/cajaController.js` `exportRegisters`: add `vueltos: toNumber(t.vueltosEntregados)` data cell + matching Excel column header; `fisicoExpected` untouched.
- [ ] 3.5 Confirm `closeRegister` (~`:159-196`) formula is untouched — no code change here; asserted by Unit D's new integrity test, not by inspection alone.

## Phase 4: Unit D — Tests (New Files + Regression Fixtures)

- [ ] 4.1 Write `tests/scenarios/cash-change.test.js`: missing/non-numeric/zero/negative `receivedAmount` → `400 CASH_RECEIVED_REQUIRED`, zero `order` rows; insufficient → `400 CASH_RECEIVED_INSUFFICIENT` naming both figures; exact match → `changeAmount === 0`; overpayment → net `amount`/`receivedAmount`/`changeAmount`/`Σ === order.amount`; response `change`; split cash+tarjeta and cash+CUENTA_CORRIENTE compute change on the cash leg only; literal `"Efectivo"` string detected as cash; non-cash leg's `receivedAmount` ignored, both columns `NULL`; discount parity with/without `receivedAmount`.
- [ ] 4.2 Write `tests/integrity/caja-expected-with-change.test.js`: shift of N overpaid cash sales → `expectedAmount === opening + Σ net cash`, `difference === 0`; zero `CashMovement` rows created; `getRegisterHistory().totals.vueltosEntregados` / `getAllRegisters()[0].totals.vueltosEntregados` equal `Σ changeAmount` excluding a cancelled overpaid sale in the same shift.
- [ ] 4.3 Register both scripts in `tests/run-all.js`.
- [ ] 4.4 **Update 6 regression fixtures to supply `receivedAmount` on every cash leg** (real, identified scope, not an afterthought): `tests/scenarios/cc-exact-payment.test.js`, `tests/scenarios/cancel-reverses-debt.test.js`, `tests/scenarios/movement-validation.test.js`, `tests/concurrency/sale-race.test.js`, `tests/concurrency/sale-vs-caja-close-race.test.js`, `tests/concurrency/caja-close-race.test.js`. Assertions stay unchanged; `movement-validation.test.js`'s exact `expectedAmount`/`difference` checks must still pass byte-identical — proof `closeRegister` is untouched.
- [ ] 4.5 Full `node tests/run-all.js` green, zero regressions.

## Phase 5: Unit E — Frontend Input/Quick-Fill/Gate

- [ ] 5.1 `DiscountSummaryModal.jsx` single mode: add `singleReceived` state; quick-fill prefills from **`finalTotal`, never `productsTotal`** (`productsTotal` is gross and ignores discounts — prefilling it would show an inflated/wrong change on any discounted sale); gate = `isCashMethod(singleMethod) ⇒ parseFloat(singleReceived) >= finalTotal`.
- [ ] 5.2 Split mode: add `receivedAmount` per `splitBreakdown` entry; per-leg quick-fill from `p.amount`; gate = every cash leg `receivedAmount >= amount`.
- [ ] 5.3 Fix `handleUpdatePayment` (~line 139-141) to spread-preserve existing fields — `{ ...p, method, amount }`, not `{ method, amount }`. Without this, `receivedAmount` is silently destroyed on any split-amount edit.
- [ ] 5.4 Live "Vuelto" display per cash leg: `Math.max(0, received - amount)`, informational only — server's `change` is authoritative.
- [ ] 5.5 Key the debounced `onPaymentChange` preview effect on a projected `{method, amount}`-only signature (not the full entry) so entering `receivedAmount` does not re-trigger the discount preview; confirm discount parity.
- [ ] 5.6 Confirm action disabled while any cash leg is invalid, alongside existing `!isCovered`/`isProcessing` conditions; `handleConfirm`'s `baseAmount` weighting keeps deriving from net `amount`, untouched.

## Phase 6: Unit F — Ticket + Arqueo Display

- [ ] 6.1 `SaleDetail.jsx` (~273-291): render received/change in BOTH the multi-leg `.map` branch and the single-leg fallback branch; change line only when `changeAmount > 0`.
- [ ] 6.2 `NewSale.jsx`: no forwarding code change needed (`finalBreakdown` already carries `receivedAmount`; `response.data` already carries `change`) — optional comment noting `change` arrives from the server, not recomputed client-side.
- [ ] 6.3 `pages/Reportes/RegisterHistory.jsx`: add "Vueltos entregados" row from `t.vueltosEntregados`; `fisicoExpected` untouched.
- [ ] 6.4 `CashRegister.jsx` (~line 126-127): update to destructure `{ items, totals }` from `getRegisterHistory`'s new response shape, add `shiftTotals` state, render "Vueltos entregados" row + per-order change in history rows. **Coordinate with Unit C's 3.3 — verify together before either merges.** `getOrderTotals` / `fisico` math (~144-165, ~226-234, ~794) untouched.
- [ ] 6.5 Confirm `posStore.js` is NOT modified — `addPayment`/`updatePayment`/`removePayment` are dead code for this flow; real payment state is `DiscountSummaryModal`'s local state and `NewSale.jsx`'s `confirmedBreakdown`.

## Sequencing Notes

- Backend-first rollout: deploy A→D before E/F per design Rollout — a stale frontend tab gets a visible, recoverable `400 CASH_RECEIVED_REQUIRED`, never a silent inflated drawer; the reverse (strict backend + old frontend) is not acceptable and must not happen.
- Cross-repo coupling (Unit C.3.3 ↔ Unit F.6.4): `getRegisterHistory`'s `{items, totals}` shape change and its one consumer must be verified together — do not let one land on `main` while the other is still pending.
- `posStore.js`: confirmed no task modifies it (6.5).
- Rebase note (0.1) is a pre-apply git operation, not a reviewable code task — do not fold it into any unit's diff.
