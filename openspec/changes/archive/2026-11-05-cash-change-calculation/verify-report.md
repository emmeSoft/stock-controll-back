# Verification Report — cash-change-calculation (Vuelto)

**Verdict: PASS WITH WARNINGS — ready to archive**, contingent on fixing the tasks.md checkbox mismatch (documentation-only, not a code gap) before archiving.

### Test/Build Evidence (actually executed, not inferred)

- `node tests/run-all.js` (backend, against confirmed LOCAL datasource `localhost:5432`/`stock_controll` per `npx prisma migrate status`): **exit code 0**, "ALL REGISTERED TESTS PASSED". 24 scripts registered in `tests/run-all.js` (22 pre-existing + 2 new: `./integrity/caja-expected-with-change.test.js`, `./scenarios/cash-change.test.js`). All passed, including every sub-assertion of the two new scripts (9 scenarios in cash-change.test.js, 3 cases in caja-expected-with-change.test.js).
- `npx vite build` (frontend): **succeeded**, "3386 modules transformed", built in 27.58s, no errors (only a pre-existing >500kB chunk-size warning, unrelated).

### Success Criteria — pass/fail with evidence

1. Cash leg missing `receivedAmount` → 400+code, pre-tx. **PASS.** `validateCashReceivedShape` (salesServices.js:117-127) called at line 202, before `getCurrentRegister`/tx open; `cash-change.test.js` CASO 1 asserts zero order rows created.
2. `receivedAmount < amount` → 400 naming both figures, zero tolerance. **PASS.** salesServices.js:487-505, message interpolates both `received`/`legAmount`; zero-tolerance `received.lt(legAmount)`, independent of `paymentTolerance`.
3. Overpayment persists `receivedAmount`/`changeAmount`, `amount` stays NET, Σ breakdown === order.amount. **PASS.** PASO 8 (salesServices.js:550-559) persists `amount: payment.amount` unchanged; CASO 4 of cash-change.test.js and CASO 1 of caja-expected-with-change.test.js assert this live against DB.
4. Sale-create response carries `change`. **PASS.** salesServices.js:705-719, `change: totalChange`; `NewSale.jsx:350` carries `response.data` (incl. `change`) into `SaleDetail`.
5. Shift of overpaid cash sales closes `difference === 0`. **PASS** — reproduces the reported incident as a passing test (`caja-expected-with-change.test.js` CASO 1, `expectedAmount === 1000+100+200`, `difference === 0`).
6. `closeRegister` formula unchanged; no `CashMovement` from a sale. **PASS.** `cajaServices.js:159-196` formula byte-identical (`openingAmount + ordersTotalEfectivo(sum of OrderPayment.amount) + income - expense`); `movement-validation.test.js`'s hardcoded `expectedAmount === 1445.44` still passes unmodified; `caja-expected-with-change.test.js` CASO 2 asserts zero `CashMovement` rows.
7. Arqueo shows per-sale change + shift total, excludes cancelled, never double-counted. **PASS.** `computeVueltosEntregados` (cajaServices.js:267-272) consumed by both `getRegisterHistory` (own explicit non-cancelled filter, line 306-307) and `getAllRegisters` (inherits already-filtered `reg.orders`, line 414); test CASO 3 asserts both equal 100, excluding the cancelled $100-change sale.
8. Exact-cash sales confirmable in one tap via quick-fill. **PASS.** `DiscountSummaryModal.jsx` single mode: `onClick={() => setSingleReceived(finalTotal.toFixed(2))}` (line ~408); split mode: per-leg `FaMagic` button `onClick={() => handleUpdateReceivedAmount(i, p.amount.toFixed(2))}` (line ~476).
9. Split cash+tarjeta and cash+CUENTA_CORRIENTE compute change on cash leg only. **PASS.** salesServices.js loop at 487-505 filters `isCashMethod` per leg; cash-change.test.js CASO 5/6 assert card leg and CC debt untouched.
10. Payment-method discounts byte-identical before/after receivedAmount entered. **PASS.** Frontend: `engineBreakdown`/`engineSignature` (DiscountSummaryModal.jsx:121-133) projects only `{method, amount}` before the preview effect fires, so typing `receivedAmount` never re-triggers the discount preview. Backend: `baseAmount` derivation untouched; cash-change.test.js CASO 9 (discount parity) passes live.
11. `tests/run-all.js` exits 0 with both new scripts registered, Level 1/2 suites still pass. **PASS**, confirmed by actual execution above.

### Cross-repo contract check

Backend response field names (`change`, `orderPayments[].receivedAmount/changeAmount`) match frontend consumers exactly:
- `SaleDetail.jsx:282,298-302` reads `p.changeAmount > 0 && p.receivedAmount != null` on both the multi-leg map and single-leg fallback — matches backend's enriched `orderPayments` keys exactly (salesServices.js:706-714).
- `CashRegister.jsx:131-132` reads `histRes.data.items` / `histRes.data.totals` — matches `getRegisterHistory`'s new `{ items, totals: { vueltosEntregados } }` envelope (cajaServices.js:309) exactly.
- `RegisterHistory.jsx:246-249` reads `t.vueltosEntregados` from `getAllRegisters` — matches `totals.vueltosEntregados` (cajaServices.js:414-425) exactly.
No field-name drift found between the two repos.

### Task checkbox vs reality mismatches (genuine findings)

- **WARNING — Phase 5 (Unit E, tasks 5.1-5.6) checkboxes are unchecked `[ ]` in `openspec/changes/cash-change-calculation/tasks.md`, but the work IS fully implemented and merged** in the frontend repo (`stock-controll-main` PR #6, "cash-change-calculation-e-frontend-input", commits e7e54b8/ec02495/3feed3a/5180485/957cf8c/44de572). Verified directly: `singleReceived` state, per-leg `receivedAmount` quick-fill, spread-preserving `handleUpdatePayment`/`handleUpdateReceivedAmount`, signature-keyed preview effect, and the confirm gate (`disabled={... || !isCashReceivedValid}`) are all present and correct in `DiscountSummaryModal.jsx`. This is a tracking gap in the backend repo's tasks.md, not a functional gap — cross-repo task tracking (backend repo's openspec folder tracks frontend-repo work) fell out of sync when the frontend PRs merged. **Action: tick 5.1-5.6 in tasks.md before archiving**, since the underlying work is verified complete.
- **SUGGESTION — Task 4.5's claimed count is wrong.** It states "28/28 scripts passed (26 pre-existing + 2 new)"; the actual registered count in `tests/run-all.js` is 24 (22 pre-existing + 2 new), confirmed by both reading the file and counting the `RUNNING:` lines in actual test output. Harmless (the suite genuinely passes end-to-end), but the written number doesn't match the code — worth a one-line correction for documentation accuracy.

### Phases 1-4 and 6 — all other task checkboxes verified accurate against real code

1.1-1.3, 2.1-2.6, 3.1-3.5, 4.1-4.5, 6.1-6.5 all read `[x]` and all independently confirmed present/correct by direct source inspection (schema, `salesServices.js`, `cajaServices.js`, `cajaController.js`, both new test files + `run-all.js`, `SaleDetail.jsx`, `NewSale.jsx`, `RegisterHistory.jsx`, `CashRegister.jsx`, `posStore.js` untouched). No other mismatches found.

### Known/deferred items — not re-reported per instructions

- `validatePayments` tolerance cap at $0.50 (unrelated code path) — not flagged.
- `posStore.js` deliberately unmodified — confirmed, not flagged as a gap.
- Nivel 5 cosmetic cleanup items — already tracked at `sdd/discount-engine-nivel3/deferred-cosmetic-findings`, not re-reported.

### Overall

No CRITICAL findings. One WARNING (tasks.md checkbox/reality drift on Unit E — cosmetic, fixable by ticking boxes) and one SUGGESTION (wrong test count in a task note). All 11 Success Criteria pass with runtime evidence. Both repos build/test green. **Ready to archive** once tasks.md is corrected (or archive now and note the correction — the underlying code is not in question).
