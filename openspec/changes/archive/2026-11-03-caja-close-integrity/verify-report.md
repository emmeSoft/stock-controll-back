# Verification Report: caja-close-integrity (Level 2)

Date: 2026-11-03
Scope: Units A-F (Phases 1-6). Phase 7 (deployed-DB migration) intentionally excluded - requires separate human consent, same treatment as Level 1's Unit 9.
Verdict: PASS

---

## 1. Fresh Test Execution

### Backend (stock-controll-back, branch caja-close-integrity-d-tests @ d50fab1)

node tests/run-all.js - 16/16 scripts registered and green:

RUNNING: ./money/money.test.js
RUNNING: ./money/serializer.test.js
RUNNING: ./money/excel-export.test.js
RUNNING: ./integrity/stock-check.test.js
RUNNING: ./concurrency/payment-race.test.js
RUNNING: ./concurrency/close-race.test.js
RUNNING: ./scenarios/cc-exact-payment.test.js
RUNNING: ./concurrency/sale-race.test.js
RUNNING: ./scenarios/cancel-reverses-debt.test.js
RUNNING: ./concurrency/stock-edit-race.test.js
RUNNING: ./scenarios/movement-validation.test.js
RUNNING: ./concurrency/caja-close-race.test.js
RUNNING: ./concurrency/sale-vs-caja-close-race.test.js
RUNNING: ./concurrency/cash-movement-vs-caja-close-race.test.js
RUNNING: ./concurrency/caja-open-race.test.js
RUNNING: ./integrity/caja-open-index.test.js
ALL REGISTERED TESTS PASSED

Regression re-runs (design.md mandatory list), run standalone with full output, both exit 0:
- tests/concurrency/sale-race.test.js - 409 (not a demoted 400) confirmed: "la venta rechazada lanza status 409, no 400 por un pre-check prematuro (visto: 409)". Proves Unit B's guard placement in salesServices.create did not regress the Level 1 stock race.
- tests/concurrency/payment-race.test.js - 409 confirmed for the balance race, unaffected by the new register guard now running ahead of it in the same transaction.
- tests/scenarios/movement-validation.test.js (inside the full run) - closed.expectedAmount === 1445.44, closed.difference === 0, confirming closeRegister's two-write contract still holds.

4 discount-engine scripts, run individually, all exit 0:
- tests/discountEngine/crud-universal.test.js PASS
- tests/discountEngine/preview-merge.test.js PASS
- tests/discountEngine/split-rules.test.js PASS
- tests/discountEngine/universal.test.js PASS

### Frontend (stock-controll-main, branch caja-close-integrity-f-ux-wiring @ 5f5f485)

No dev server / test runner available (house style has no frontend test framework for this project); verification is via npx eslint on the 6 touched/created files, diffed against the pre-change (main) versions of the same files.

- Pre-change baseline: 12 no-unused-vars errors (all pre-existing, unrelated to this change - confirmed identical content before/after in CashRegister.jsx and NewSale.jsx), 4 warnings.
- Post-change: same 12 errors, 5 warnings - exactly one new warning, react-refresh/only-export-components on the new CashRegisterClosedModal.jsx (cosmetic, HMR-only; the file exports both the component and CASH_REGISTER_RECOVERY_CODES).
- No new lint errors introduced by this change. Confirmed independently (not trusting the apply-progress self-report).

---

## 2. Deadlock-Avoidance Ordering Rule (Design Decision 2) - Independently Re-Verified

Re-read the actual committed code (not quoted snippets) for all three cash-binding sites:

| Site | File:line | First tx.* statement | Verdict |
|---|---|---|---|
| salesServices.create | services/salesServices.js:156-195 | PASO 1 (tx.product.findMany, a read, no lock) then PASO 1.5 assertRegisterOpen(tx, ...) at line 191, before PASO 2/3/4's first write (tx.discountRule.update at line ~316) | PASS - Guard is the first write; placed after the one read-only pre-check, matching design's explicit requirement |
| movimientosServices.createMovement | services/movimientosServices.js:29-37 | assertRegisterOpen is the literal first statement inside the $transaction callback, before tx.cashMovement.create | PASS |
| currentAccountServices.registerPayment | services/currentAccountServices.js:296-314 | assertRegisterOpen is the literal first statement inside the $transaction callback (labeled "0."), before tx.currentAccount.updateMany (balance guard) and tx.cashMovement.create | PASS |
| cajaServices.closeRegister | services/cajaServices.js:133-147 | tx.cashRegister.updateMany({status:'OPEN' to 'CLOSED'}) is the first statement (the flip itself is the guard) | PASS |

No statement that inserts/updates a row referencing CashRegister (order, cashMovement, currentAccount) precedes the guard at any of the three sites. Lock order CashRegister < DiscountRule < CurrentAccount < Product holds with no cycle. Confirmed independently, adversarially - no drift found between any of the four sites.

---

## 3. Native Arithmetic Leak Check

Grepped the full diff (git diff main vs tip) of every touched backend file (services/, controllers/, prisma/) for bare plus/minus/lt/gt operators on Decimal-typed fields. Zero hits in actual code - all matches were comments. closeRegister's totals math uses money(...).plus(...).minus(...) plus round(...) throughout, identical in arithmetic style to the pre-change code (only the read ordering moved inside the transaction, the formula itself is untouched). No new money arithmetic was introduced anywhere in this change, consistent with the proposal's "Modified Capabilities: None" claim for money-precision.

Frontend diff: no money arithmetic at all - all 6 files are UI wiring/state only (isProcessing booleans, code string comparisons, modal props, useSearchParams).

---

## 4. Error code Field Correctness - Direct String Comparison Across Repos

Backend thrown codes (services/cajaServices.js, read directly):
- CASH_REGISTER_ALREADY_OPEN - line 93 (openRegister's P2002 catch)
- CASH_REGISTER_ALREADY_CLOSED - line 145 (closeRegister's count===0 branch)
- CASH_REGISTER_CLOSED - line 240 (assertRegisterOpen's shared guard, consumed by sale/movement/CC-payment)

Frontend consumed codes (src/components/Modals/CashRegisterClosedModal.jsx, read directly):

export const CASH_REGISTER_RECOVERY_CODES = [
  "CASH_REGISTER_CLOSED",
  "CASH_REGISTER_ALREADY_CLOSED",
  "CASH_REGISTER_ALREADY_OPEN",
];

All three strings match exactly between where they are thrown and where they are consumed. No typo. All four controllers (caja, sales, movimientos, currentAccount) additively forward code gated on error.status - verified in the backend diff, identical four-line pattern in each.

---

## 5. "Actualizar" vs "Abrir Caja" Distinction - Confirmed Genuinely Different

RECOVERY_BY_CODE map in CashRegisterClosedModal.jsx:

| Code | confirmText | Case |
|---|---|---|
| CASH_REGISTER_CLOSED | Abrir caja | stale binding (sale/movement/CC payment hit a register that closed mid-flight) |
| CASH_REGISTER_ALREADY_CLOSED | Actualizar | a close that lost the race to another close |
| CASH_REGISTER_ALREADY_OPEN | Actualizar | an open that lost the race to another open |

Not a copy-paste: CASH_REGISTER_CLOSED's action routes to opening a new register (navigate to /sells?tab=register from NewSale.jsx/CurrentAccountDetails.jsx, or a local fetchData() refetch from CashRegister.jsx since it is already on the register tab). The two ALREADY_* codes both get "Actualizar" (refetch/refresh) - correctly, since in both of those cases opening a register is nonsensical (one already exists or the close already happened). This matches design.md's resolved Open Question 3 exactly.

---

## 6. Partial Unique Index Survival

- tests/integrity/caja-open-index.test.js (fresh run, part of the full suite): confirms CashRegister_one_open_per_store exists in pg_indexes, and a raw second-OPEN insert for the same store is rejected (P2010/unique_violation), with exactly one OPEN row remaining afterward. PASS.
- tests/concurrency/caja-open-race.test.js (fresh run): two concurrent openRegister calls for the same store - exactly one succeeds, the other 409/CASH_REGISTER_ALREADY_OPEN, exactly one OPEN row. PASS.
- npx prisma migrate status (fresh run against the local DB): "3 migrations found in prisma/migrations", "Database schema is up to date!" - clean, no drift.

---

## 7. Git Chain Integrity - Both Repos

Backend (stock-controll-back, local-only, no push):

main (= origin/main, e5eb5c5)
  -> caja-close-integrity-a-foundation (05f5513)
    -> caja-close-integrity-b-register-guards (11d7137)
      -> caja-close-integrity-c-error-codes (6a43533)
        -> caja-close-integrity-d-tests (d50fab1)  [tip]

Each child branch's exclusive commit range (git log child ^parent) contains only that unit's own commits - no branch is accidentally rooted on main instead of its stated parent. git diff main origin/main is empty.

Frontend (stock-controll-main, local-only, no push):

main (= origin/main, c1fbd74)
  -> caja-close-integrity-e-frontend-guards (22ac53e)
    -> caja-close-integrity-f-ux-wiring (5f5f485)  [tip]

git diff main origin/main is empty. E's branch pointer is untouched at 22ac53e (the mid-session git incident - an initial commit landed directly on E instead of a new F branch - was corrected cleanly before any push, confirmed via git log --oneline --all --graph; not re-litigated further here per instructions).

No PRs: gh pr list --state all on both repos shows zero PRs referencing any caja-close-integrity-* branch (backend's PR history tops out at #28, Level 1's money-stock-integrity, already merged; frontend tops out at #3, an unrelated favicon change). Confirmed nothing was pushed or opened anywhere.

---

## 8. Scope Discipline

- Phase 7 untouched: tasks.md Phase 7 (deployed-migration pre-flight + apply + deploy) remains fully unchecked. No deploy scripts, CI config, or .env/connection-string files appear anywhere in either repo's diff against main. Correctly excluded, same treatment as Level 1's Unit 9.
- Backend diff (git diff main caja-close-integrity-d-tests --stat): exactly 17 files - 4 controllers, openspec/changes/.../tasks.md, 1 migration, schema.prisma, 4 services, 5 new test files, tests/run-all.js. Matches the proposal's Affected Areas table exactly. No discount maxUnits/baseAmount changes, no payment-tolerance changes, no CI/pipeline files, no productsServices.update() cleanup - all correctly left out of scope.
- Frontend diff (git diff main caja-close-integrity-f-ux-wiring --stat): exactly 6 files, matching the proposal's addendum-expanded Affected Areas (the original 3 plus CashRegisterClosedModal.jsx plus SalesDashboard.jsx plus NewSale.jsx, both addenda explicitly approved by the product owner). No unrelated UI changes.

---

## Findings

### CRITICAL
None.

### WARNING
None.

### SUGGESTION

1. Uncommitted openspec bookkeeping in the backend repo. At time of verification, the backend repo's working tree (on branch caja-close-integrity-d-tests) has:
   - openspec/changes/caja-close-integrity/tasks.md modified but uncommitted (marks Phase 5/6 - the frontend units - as done, which is accurate given Units E/F are done in the other repo, but the checkbox state exists only in the working tree, not in any commit).
   - design.md, proposal.md, specs/ present but untracked (never added to any commit on this branch chain).

   None of this affects runtime correctness - it is SDD paperwork, not code - but it should be committed (or folded into the archive step) before this change is considered closed, so the artifact trail in git matches the artifact trail in Engram.

2. Proposal's own Success Criteria checklist (proposal.md) still shows all boxes unchecked, even though every criterion is now demonstrably met (see cross-reference table below). This is cosmetic - likely intended to be checked off at archive time - but flagging so it is not mistaken for incomplete work by a future reader skimming only proposal.md.

---

## Success Criteria Cross-Reference (proposal.md, including both 2026-11-03 addenda)

| # | Criterion | Evidence |
|---|---|---|
| 1 | Concurrent close: exactly one wins, other 409, no silent overwrite | tests/concurrency/caja-close-race.test.js - PASS |
| 2 | Sale in close window: counted-or-rejected, never both | tests/concurrency/sale-vs-caja-close-race.test.js CASO 1-3 - PASS |
| 3 | No order with cashRegisterId pointing at a register closed before the order's createdAt | Same script's global assertion - PASS |
| 4 | Balanced drawer, difference===0 under concurrent sale traffic | Same script, CASO 3 - PASS |
| 5 | closeRegister on CLOSED register returns 409, status forwarded | tests/concurrency/caja-close-race.test.js + direct code read of cajaController.js - PASS |
| 6 | Double-click guards (open/close/movement/payment), exactly one request, visible disable | Code-verified in CashRegister.jsx, RegisterPaymentModal.jsx, CurrentAccountDetails.jsx (no frontend test framework in this project; verified by source inspection + eslint, consistent with Unit E/F apply-progress) |
| 7 | Movement/CC payment in close window: same invariant as sale | tests/concurrency/cash-movement-vs-caja-close-race.test.js CASO 1-2 - PASS |
| 8 | Two terminals racing open: exactly one succeeds | tests/concurrency/caja-open-race.test.js - PASS |
| 9 | Agreed copy plus correct recovery action per code, not a bare string | CashRegisterClosedModal.jsx plus all 5 wired call sites - PASS, verified in sections 4-5 above |
| 10 | tests/run-all.js exits 0 with new scripts registered; movement-validation.test.js still passes | Fresh run, this report, section 1 - PASS |

---

## Final Verdict

PASS. All 6 implemented units (A-F) are correct, test-verified, scope-disciplined, and git-clean on both repos. Zero CRITICAL or WARNING findings. Two SUGGESTION-level paperwork items (uncommitted openspec files in the backend repo; proposal checklist not re-checked) should be resolved at archive time but do not block it.

Phase 7 (deployed-DB migration) remains correctly untouched and requires its own separate human consent before proceeding, per the proposal and per Level 1's precedent.
