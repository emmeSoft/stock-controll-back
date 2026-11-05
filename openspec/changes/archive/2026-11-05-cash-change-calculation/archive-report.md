# Archive Report: Cash Change Calculation (Vuelto)

**Date Archived**: 2026-11-05
**Change Name**: cash-change-calculation
**Artifact Store Mode**: hybrid
**Status**: ARCHIVED — all 6 implementation units merged to main, verification complete

---

## Executive Summary

The `cash-change-calculation` (Level 3) change has been fully implemented, tested, and verified across both the backend (`stock-controll-back`) and frontend (`stock-controll-main`) repositories. All success criteria passed with runtime evidence (24/24 tests), and both merged codebases ship without CRITICAL findings. The change closes a money bug where overpaid cash sales could inflate the drawer's expected totals by excluding the physically-returned change from the ledger.

---

## What Shipped

### New Capability
- **cash-change-handling**: a sale with a cash leg now records what the customer handed over (`receivedAmount`), what was applied to the sale (`amount`, net), and what was returned (`changeAmount`). The received amount is mandatory (validated pre-transaction), an insufficient amount is rejected with zero tolerance, and change is computed server-side and never inferred by the client.

### Modified Capability
- **cash-register-integrity**: the "Register-Bound Operation Consistency" requirement was clarified to state that a cash `OrderPayment.amount` is the NET amount applied to the sale and MUST NEVER carry a received-amount surplus. This invariant ensures the drawer stays balanced when a cash payment exceeds the sale total, since the surplus never enters the drawer total and no offsetting movement is needed.

---

## Implementation Summary

### Backend Changes (stock-controll-back, main branch)

| PR | Unit | Component | Status |
|---|---|---|---|
| #36 | A | Schema + Migration | Merged |
| #37 | B | Validation, Change Math, Persistence | Merged |
| #38 | C | Reporting + Excel Export | Merged |
| #39 | D | Tests + Regression Fixtures | Merged |

**Test Results**: `node tests/run-all.js` — 24/24 scripts passed (22 pre-existing + 2 new), exit code 0
- `tests/scenarios/cash-change.test.js` — 9 scenarios covering mandatory/insufficient checks, net amount persistence, discount parity, split payments
- `tests/integrity/caja-expected-with-change.test.js` — drawer invariant confirmed: overpaid sales with change handed back close with `difference === 0`
- All regression fixtures (6 modified) supply `receivedAmount` on cash legs; assertions unchanged and passing

**Key Assertions**:
1. Missing `receivedAmount` → 400 CASH_RECEIVED_REQUIRED, pre-transaction
2. Insufficient `receivedAmount` → 400 CASH_RECEIVED_INSUFFICIENT, naming both figures, zero tolerance
3. `OrderPayment.amount` stays NET; `receivedAmount` and `changeAmount` persisted separately
4. `closeRegister` formula unchanged; `expectedAmount === opening + Σ net cash` (byte-identical)
5. No `CashMovement` rows created by a sale
6. `getRegisterHistory` response shape changed to `{ items, totals: { vueltosEntregados } }`

### Frontend Changes (stock-controll-main, main branch, separate repo)

| PR | Unit | Component | Status |
|---|---|---|---|
| #6 | E | `DiscountSummaryModal.jsx` Input/Quick-Fill/Gate | Merged |
| #7 | F | Ticket + Arqueo Display | Merged |

**Build Results**: `npx vite build` — 3386 modules, succeeded in 27.58s, no errors

**Key Features**:
- "Monto recibido" input per cash leg (single + split mode)
- "Exact amount" quick-fill prefilled with the leg's amount
- Confirm action blocked until every cash leg has valid received amount
- Received/change rendered on sale ticket and shift arqueo
- Payment-method discounts byte-identical before/after received amount entered
- `posStore.js` not modified (dead code for this flow)

---

## Specs Merged to Main

| Domain | Action | File |
|---|---|---|
| cash-change-handling | Created (NEW) | `openspec/specs/cash-change-handling/spec.md` |
| cash-register-integrity | Updated (MODIFIED) | `openspec/specs/cash-register-integrity/spec.md` |

**Delta Spec Merge for cash-register-integrity**:
- Updated the "Register-Bound Operation Consistency" requirement to include clarifications about net amount handling and two new scenarios
- Added "Balanced drawer with an overpaid cash sale and change given back" scenario
- Added "Close computation formula is byte-identical to pre-change behavior" scenario
- No other requirements modified; the spec continues to cover exactly-once close and race-free register binding

**Backward Compatibility**:
- New columns (`OrderPayment.receivedAmount`, `OrderPayment.changeAmount`) are nullable
- Pre-existing orders render with `NULL` values and behave exactly as before
- No data migration or backfill applied

---

## Verification Evidence

**From verify-report observation (#513)**:

- **Verdict**: PASS WITH WARNINGS (0 CRITICAL, 1 cosmetic WARNING, 1 SUGGESTION)
- **Runtime Tests**: All 24 registered scripts passed with exit code 0
- **Cross-Repo Field-Name Verification**: Backend response fields (`change`, `orderPayments[].receivedAmount/changeAmount`) match frontend consumer expectations exactly
- **Incident Reproduction**: Drawer invariant test confirms the reported production incident (overpaid sales inflating expected totals) is now impossible; the test closes with `difference === 0`

**Pre-Archive Corrections Applied**:
- Phase 5 (Unit E) task checkboxes were ticked from `[ ]` to `[x]` after verifying work was complete in the frontend repo
- Task 4.5 test count corrected from claimed 28/28 to actual 24/24

---

## Artifact Traceability

| Artifact Type | Observation ID | Topic Key | Status |
|---|---|---|---|
| Proposal | #504 | sdd/cash-change-calculation/proposal | Retrieved |
| Spec | #507 | sdd/cash-change-calculation/spec | Retrieved |
| Design | #508 | sdd/cash-change-calculation/design | Retrieved |
| Tasks | #509 | sdd/cash-change-calculation/tasks | Retrieved |
| Apply Progress | #510 | sdd/cash-change-calculation/apply-progress | Retrieved |
| Verify Report | #513 | sdd/cash-change-calculation/verify-report | Retrieved |

---

## Deployment Notes

**Rollout Order**: Backend first, then frontend
- Backend PRs #36-39 merged to `stock-controll-back` main
- Frontend PRs #6-7 merged to `stock-controll-main` main
- Between deployments, a stale frontend tab receives a visible, recoverable `400 CASH_RECEIVED_REQUIRED` error

**Migration Safety**:
- Additive, nullable columns
- No pre-flight query required
- Applied via `npx prisma migrate deploy` (or `migrate dev` for local testing)
- Can be left in place after code rollback with zero behavioral effect (pre-change rows keep `NULL`)

**Rollback Order** (if needed): Frontend first, then backend
- Revert frontend code completely
- Revert backend code per file (independent paths)
- Migration columns can remain in database (optional cleanup)

---

## Files Archived

This archive folder (`openspec/changes/archive/2026-11-05-cash-change-calculation/`) contains:
- `proposal.md` — business intent and scope
- `design.md` — technical architecture and decisions
- `tasks.md` — work breakdown (Units A-F, all tasks checked ✓)
- `specs/cash-change-handling/spec.md` — new requirement spec
- `specs/cash-register-integrity/spec.md` — delta (changes to existing spec)
- `verify-report.md` — test evidence and cross-repo verification
- `archive-report.md` — this file

---

## Next Steps

The SDD cycle is complete. The change is ready for production deployment. No follow-up issues or deferred work items are carried forward; the drawdown list is empty.

Any future enhancements to change-related functionality (e.g., multi-currency, denomination presets, `getGlobalHistory` shift totals) should be initiated as a new SDD change.
