# Tasks: Cash-Register Close Integrity (Level 2)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~950–1,200 (backend ~700–800 across Units A–D, frontend ~200–260 across Units E–F) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (A) → PR 2 (B) → PR 3 (C) → PR 4 (D) → PR 5 (E) → PR 6 (F); Unit E can run parallel to A–D |
| Delivery strategy | ask-on-risk (default; not overridden in launch prompt) |
| Chain strategy | pending — see flag below |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

**Chain strategy flag**: Level 1 (`money-stock-integrity`) used `feature-branch-chain`, but that choice was forced by a hard deploy-coupling defect (Decimal schema + JSON serializer had to land in the same deploy). No equivalent coupling exists here: per design's Rollout section the backend 409s are readable without the frontend modal and the modal is inert (falls back to `alert`) without the `code` field, and per the proposal's Rollback Plan "a guard at one site is harmless without the others." `stacked-to-main` is therefore viable. Orchestrator must pick explicitly rather than inherit Level 1's choice by default.

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| A | `closeRegister` + `openRegister` atomic guards + partial unique index migration | PR 1 | Foundation, same reasoning as Level 1 Unit 1. ~120–150 lines |
| B | Shared `assertRegisterOpen` helper + wiring into sales/movimientos/currentAccount | PR 2 | Depends on PR 1 (same file, `cajaServices.js`). ~90–100 lines |
| C | `code` field on error bodies, 4 controllers | PR 3 | Depends on PR 1+2 (codes defined there). ~25–30 lines |
| D | 5 backend test scripts (4 concurrency + 1 integrity) | PR 4 | Depends on PR 1–3 (tests assert `code`). ~450–550 lines |
| E | Frontend double-submit guards (3 files) | PR 5 | No backend dependency — may parallelize with A–D. ~85 lines |
| F | Frontend UX wiring (`CashRegisterClosedModal.jsx`, tab routing, `NewSale.jsx`) | PR 6 | Needs PR 3's `code` field to be meaningful. **Touches the same 2 files as Unit E** (`CashRegister.jsx`, `RegisterPaymentModal.jsx`+parent) — base PR 6 on PR 5's branch to avoid overlapping diffs, do not develop in parallel. ~140 lines |

## Phase 1: Unit A — Close/Open Atomic Guards + Migration Foundation

- [x] 1.1 `services/cajaServices.js` `closeRegister`: wrap in `$transaction`; statement 1 is `updateMany({where:{id,status:'OPEN'},data:{status:'CLOSED',closedByUserId,closedAt}})`, `count===0` → `{status:409, code:'CASH_REGISTER_ALREADY_CLOSED'}`; re-read via `findUnique`; snapshot orders/movements AFTER the flip; totals write last. Traces: cash-register-integrity "Exactly-Once Register Close".
- [x] 1.2 `services/cajaServices.js` `openRegister`: keep friendly pre-check; wrap `create` in try/catch; on `e.code==='P2002'` throw `{status:409, code:'CASH_REGISTER_ALREADY_OPEN', cause:e}`, log `e.meta?.target`. Traces: cash-register-integrity "Exactly-Once Register Open Per Store".
- [x] 1.3 Pre-flight (LOCAL, mandatory before 1.4): run `SELECT "storeId", count(*) FROM "CashRegister" WHERE status='OPEN' GROUP BY 1 HAVING count(*)>1` against the local DB; zero rows before proceeding.
- [x] 1.4 Hand-write `prisma/migrations/<ts>_cashregister_one_open_per_store/migration.sql`: `CREATE UNIQUE INDEX "CashRegister_one_open_per_store" ON "CashRegister" ("storeId") WHERE "status"='OPEN';`. Apply locally via `prisma migrate dev`, do not let it regenerate into the baseline.
- [x] 1.5 Add comment above `model CashRegister` in `schema.prisma` naming the index and its migration (survival layer 2).
- [x] 1.6 Regression: run `tests/scenarios/movement-validation.test.js` directly — confirms `closeRegister`'s two-write contract (`closed.expectedAmount`, `closed.difference`) still holds.

## Phase 2: Unit B — Shared Guard Helper + Wiring

- [x] 2.1 `services/cajaServices.js`: add exported `assertRegisterOpen(tx, registerId, message)` — no-op conditional `updateMany({status:'OPEN'})`, `count===0` → `{status:409, code:'CASH_REGISTER_CLOSED'}`.
- [x] 2.2 `services/salesServices.js` `create`: call `assertRegisterOpen` after PASO 1's read + friendly pre-check, before PASO 3/4 (first write).
- [x] 2.3 `services/movimientosServices.js` `createMovement`: wrap the existing bare `cashMovement.create` in a NEW `$transaction`; guard is statement 1.
- [x] 2.4 `services/currentAccountServices.js` `registerPayment`: guard as statement 1 of the existing `$transaction`, before the `currentAccount.updateMany` balance guard.
- [x] 2.5 **Deadlock-ordering verification (mandatory, not polish)**: review the diff of 2.2–2.4 statement-by-statement — confirm the guard call is literally the FIRST statement executed inside each transaction (not merely functionally equivalent), per design Decision 2. Confirm no statement that inserts/updates a row referencing `CashRegister` (order, cashMovement, currentAccount) precedes it. Confirm the resulting lock order `CashRegister < DiscountRule < CurrentAccount < Product` holds across all three sites with no cycle.
- [x] 2.6 Confirm 2.2's placement does not move earlier than PASO 1 (would regress `tests/concurrency/sale-race.test.js` from 409 to the friendly 400 pre-check).

## Phase 3: Unit C — Error `code` Field

- [x] 3.1 `controllers/cajaController.js`: in the catch block, `const code = error.status ? error.code : undefined; res.status(error.status||400).json({message:error.message, ...(code&&{code})});`.
- [x] 3.2 `controllers/salesController.js` `createSale`: same pattern.
- [x] 3.3 `controllers/movimientosController.js` `createMovement`: same pattern.
- [x] 3.4 `controllers/currentAccountController.js` `registerPayment`: same pattern.

## Phase 4: Unit D — Backend Test Scripts (4 Concurrency + 1 Integrity)

- [x] 4.1 `tests/concurrency/caja-close-race.test.js`: reuse `payment-race.test.js`'s two-party `$transaction` barrier; barrier(2) over two `closeRegister` calls — exactly one fulfilled, one 409/`CASH_REGISTER_ALREADY_CLOSED`, winner's totals persisted. Traces: "Concurrent double close."
- [x] 4.2 `tests/concurrency/sale-vs-caja-close-race.test.js`: CASO 1 barrier(2) sale‖close (assert invariant, not interleaving); CASO 2 deterministic close-first (sale rejected, zero `order` rows); CASO 3 deterministic sale-first (`expectedAmount` includes the sale); global assertion no `order.createdAt` later than its register's `closedAt`. Traces: "Sale committed in the close window."
- [x] 4.3 `tests/concurrency/cash-movement-vs-caja-close-race.test.js`: CASO 1 `createMovement`‖close, CASO 2 `registerPayment`‖close, same barrier pattern. Traces: "Manual movement or cash CC payment committed in the close window."
- [x] 4.4 `tests/concurrency/caja-open-race.test.js`: barrier on `svcPrisma.cashRegister.create` (no `$transaction` to patch here); two `openRegister` calls for the same store, exactly one fulfilled, one 409/`CASH_REGISTER_ALREADY_OPEN`; fixture needs real `bcrypt.hash`. Traces: "Two terminals race to open the same store's register."
- [x] 4.5 `tests/integrity/caja-open-index.test.js`: assert `CashRegister_one_open_per_store` exists in `pg_indexes`; assert a raw second-OPEN insert is rejected.
- [x] 4.6 Register all 5 scripts in `tests/run-all.js`.
- [x] 4.7 Regression re-run (mandatory before merge): `sale-race.test.js`, `payment-race.test.js`, `movement-validation.test.js` all still green.

## Phase 5: Unit E — Frontend Double-Submit Guards

- [ ] 5.1 `CashRegister.jsx`: `isProcessing` guard + early return + disabled button + `finally` reset on `executeOpen`/`executeClose`; `executeMovement` additionally closes its `ConfirmModal` before awaiting. Traces: pos-submit-safety scenarios 1–3.
- [ ] 5.2 `RegisterPaymentModal.jsx`: `isSubmitting` guard + disabled submit control.
- [ ] 5.3 `CurrentAccountDetails.jsx` `handleRegisterPayment`: parent guard matching 5.2. Traces: pos-submit-safety scenario 4.

## Phase 6: Unit F — Frontend UX Wiring (`code`-Driven Recovery)

- [ ] 6.1 Create `src/components/Modals/CashRegisterClosedModal.jsx`: wraps `ConfirmModal`; derives label/action from `code` (`CASH_REGISTER_CLOSED`→"Abrir caja"; `ALREADY_CLOSED`/`ALREADY_OPEN`→"Actualizar"); owns the 5 locked copy strings.
- [ ] 6.2 `SalesDashboard.jsx`: read initial tab from `useSearchParams()` (`?tab=register`).
- [ ] 6.3 `NewSale.jsx`: in the sale-create catch, if `status===409 && data.code` open the modal; else keep the existing `alert`.
- [ ] 6.4 `CashRegister.jsx`: wire the modal for its three codes (confirm action = refetch, already on the register tab).
- [ ] 6.5 `RegisterPaymentModal.jsx` + `CurrentAccountDetails.jsx`: wire the modal, confirm action `navigate('/sells?tab=register')`.

## Phase 7: Deployed Migration (Ops — Not a Code PR, Separate Human Consent Required)

- [ ] 7.1 ⚠️ Pre-flight against the DEPLOYED DB: same `GROUP BY storeId HAVING count(*)>1` query. Requires its own explicit consent — do NOT bundle with any code-reviewable task.
- [ ] 7.2 ⚠️ DESTRUCTIVE-ADJACENT — apply the migration on the deployed DB over the **direct** connection (port 5432, not the 6543 pooler). Requires direct, explicit human confirmation before running.
- [ ] 7.3 Deploy backend and frontend (matched pair per design, but per the chain-strategy flag above, neither technically blocks the other).

## Sequencing Notes

- No unresolved proposal/design conflict found — all four design-phase Open Questions are marked `[x]` resolved and consistent with the proposal's two addenda; the earlier "Controller changes: None" tension is explicitly resolved in favor of the additive `code` field (Decision 7 / addendum 2), not silently overridden.
- Hard constraint preserved: Unit B's guard write MUST be the first statement in each of the three transactions (Phase 2, task 2.5) — this is load-bearing for deadlock avoidance, not optional ordering.
- File-conflict flag: Units E and F both touch `CashRegister.jsx` and `RegisterPaymentModal.jsx`/`CurrentAccountDetails.jsx`. Branch PR 6 (F) from PR 5 (E), do not develop in parallel.
- Deployed-DB migration (Phase 7) is intentionally excluded from any code-reviewable PR, mirroring Level 1's Unit 9 treatment.
