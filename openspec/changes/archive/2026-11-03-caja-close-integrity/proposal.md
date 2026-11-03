# Proposal: Cash-Register Close Integrity (Level 2)

## Intent

Level 1 (`2026-11-02-money-stock-integrity`) closed money precision and the sale/stock/current-account TOCTOU races. `cajaServices.closeRegister` was deliberately left untouched (verify-report line 107 confirms it is still a bare `prisma.cashRegister.update`). Two audit-confirmed defects remain, both of which make a physically balanced drawer report a false discrepancy or silently lose a close:

- **Double close / silent overwrite** (`cajaServices.js:96-156`, audit finding #2): the `findFirst({status:'OPEN'})` check and the final `update` are neither in one transaction nor keyed on `status:'OPEN'` at write time. Two concurrent close submissions both pass; the second silently overwrites the first's `closingAmount` / `difference` / `observation`. No conflict, no trace.
- **Phantom discrepancy from an in-flight sale** (`cajaServices.js:107-113` + `salesServices.js:144`, audit finding #3): the close's order snapshot is read before the register flips to `CLOSED`, while `salesServices.create` binds `cashRegisterId` (`salesServices.js:381`) from a separate unlocked read. A sale committed in that window is excluded from `expectedAmount` while its cash is physically in the drawer, and the order stays permanently attached to an already-closed register.

Frontend side, the same two defects are reachable by a plain double-click: `CashRegister.jsx` (`executeOpen:182`, `executeClose:223`, `executeMovement:251`) and `RegisterPaymentModal.jsx` have no submit guard, and `executeMovement` leaves its `ConfirmModal` clickable for the whole request. `NewSale.jsx:322` already implements the correct guard — the pattern exists, it is just not applied here.

**Why now**: closing the drawer is a daily, money-bearing, irreversible operation. A false discrepancy forces a manual arqueo and erodes trust in every subsequent close.

## Scope

### In Scope

1. **`cajaServices.closeRegister` atomic status guard** — conditional write with `status: 'OPEN'` in the `WHERE`, `count === 0` → `throw Object.assign(new Error(msg), { status: 409 })`. Read + compute + write move into one `$transaction`; the status flip must be ordered so the totals snapshot cannot miss a sale that is still allowed to commit.
2. **`salesServices.create` atomic register validation** — validate the sale's cash register is still `OPEN` at the moment of the stock-decrement write, inside the same `$transaction`, using the same atomic-guard idiom. A sale racing a close either lands cleanly before the close (correctly counted in `expectedAmount`) or is rejected with 409 — never silently excluded while the customer is charged. The existing pre-check at `salesServices.js:144-147` stays as the fast, friendly non-racing error.
3. **`movimientosServices.createMovement` and `currentAccountServices.registerPayment` atomic register validation** — same idiom as item 2, applied to the other two cash-binding paths found to share the identical unlocked `getCurrentRegister` read. Fixing only the sale path would leave the close invariant breakable via a manual cash movement or a CC cash payment on day one.
4. **`openRegister` double-open guard** — a partial unique index on `(storeId) WHERE status = 'OPEN'` so two terminals can never both open a register for the same store, backed by the same atomic-guard idiom at the application layer (409 on conflict, not a raw constraint-violation 500).
5. **Frontend double-submit guards** — apply the `NewSale.jsx:65,322-323` pattern (`isProcessing` state + early return + disabled button + `finally` reset) to `CashRegister.jsx` `executeOpen` / `executeClose` / `executeMovement` and to `RegisterPaymentModal.jsx` (and its parent `handleRegisterPayment` in `CurrentAccountDetails.jsx`). `executeMovement` must also close its `ConfirmModal` before awaiting, matching `components/CurrentAccount/PaymentForm.jsx`.

### Out of Scope (each is a later level)

- Discount engine `maxUnits` / `baseAmount` logic bugs
- Payment tolerance value in `validatePayments`
- CI / migration-deploy pipeline
- `productsServices.update()`'s `stock`-in-body cleanup (deferred by product-owner decision: "más adelante haré un SDD de limpieza profunda")
- All remaining "hallazgos menores" from the interview doc not already closed by Level 1 (`runPipeline` arity, console logs, `runningDiscount`, missing `orderBy`, `client.dni` uniqueness, `order.status` enum)
- Float residue in caja close math — already closed by Level 1's Decimal migration

## Capabilities

### New Capabilities
- `cash-register-integrity`: closing a register is exactly-once and its totals are consistent with every operation bound to it; operations may only bind to an `OPEN` register.
- `pos-submit-safety`: every money-bearing POS submit handler is single-flight (no duplicate request from a double-click).

### Modified Capabilities
- None. `money-precision` and `stock-history-integrity` are unaffected — no new money arithmetic is introduced.

## Approach (locked decisions)

| Decision | Chosen | Rejected |
|---|---|---|
| Close concurrency | Conditional write with `status:'OPEN'` in the `WHERE`; `count === 0` → 409 | Pre-check `if` (the current bug); `$transaction` wrapper alone (unsafe under READ COMMITTED) |
| Error contract | House idiom `Object.assign(new Error(msg), { status: 409 })` | New error class / custom middleware |
| Controller changes | None for status forwarding — `cajaController.js:19` already does `res.status(error.status \|\| 400)`. A `code` field (`CASH_REGISTER_ALREADY_CLOSED` / `_ALREADY_OPEN` / a shared one for the three stale-binding sites) is added to the error body so the frontend can pick the right recovery action — see addendum. | Touching how status itself is forwarded; substring-matching the Spanish message in the frontend to discriminate cases |
| Sale ↔ register binding | Validated atomically at the stock-decrement write, same `$transaction` | Unlocked pre-read only (the current bug); advisory locks |
| Guard write ordering | The register-OPEN guard MUST be the first write in every transaction that binds to it (sale, movement, CC payment) | Guarding after the domain write — an `order`/`cashMovement` FK insert takes an implicit `FOR KEY SHARE` lock on the register row first, so guarding afterward forces a lock upgrade and risks a deadlock (40P01) between two concurrent binders |
| Frontend guard | Reuse `NewSale.jsx`'s `isProcessing` + disabled-button pattern verbatim, PLUS a shared `CashRegisterClosedModal.jsx` (over the existing `ConfirmModal`) that reads the new `code` and shows the agreed copy + the right recovery action | Built-in guard inside the shared `ConfirmModal.jsx` (wider blast radius, 4 call sites rely on current behavior) |
| Money arithmetic | None added; existing `utils/money.js` calls untouched | Re-deriving totals |
| Tests | House style: plain `node`, local `assert`, registered in `tests/run-all.js`. Strict TDD not active for this project. | Introducing a test framework |

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `services/cajaServices.js` (`closeRegister`, 77-159; `openRegister`, 56-72) | Modified | Single `$transaction`; conditional status write; 409 on `count === 0`; atomic open guard backed by the new unique index |
| `services/salesServices.js` (`create`, ~144 and PASO 10 ~501-525) | Modified | Atomic register-still-`OPEN` validation inside the sale transaction |
| `services/movimientosServices.js` (`createMovement`, ~7) | Modified | Atomic register-still-`OPEN` validation |
| `services/currentAccountServices.js` (`registerPayment`, ~280) | Modified | Atomic register-still-`OPEN` validation for cash CC payments |
| `prisma/schema.prisma`, `prisma/migrations/` | Modified | Partial unique index on `CashRegister (storeId) WHERE status = 'OPEN'` (hand-written raw SQL — PSL cannot express a partial `@@unique`, same class of gap as Level 1's `CHECK` constraint) |
| `tests/concurrency/caja-close-race.test.js` | New | Named to avoid colliding with the existing `close-race.test.js` (current-account close, Level 1) |
| `tests/concurrency/sale-vs-caja-close-race.test.js` | New | Sale racing a close |
| `tests/concurrency/cash-movement-vs-caja-close-race.test.js` | New | Manual movement + cash CC payment racing a close |
| `tests/concurrency/caja-open-race.test.js` | New | Two terminals racing to open the same store's register |
| `tests/integrity/caja-open-index.test.js` | New | Asserts the partial unique index exists in `pg_indexes` — the only thing that catches it being silently dropped by a future `migrate dev` regeneration |
| `tests/run-all.js` | Modified | Register the five new scripts |
| `stock-controll-main/src/pages/sales/CashRegister.jsx` | Modified | Guards on `executeOpen` / `executeClose` / `executeMovement` |
| `stock-controll-main/src/components/Modals/RegisterPaymentModal.jsx` | Modified | `isSubmitting` guard + disabled submit |
| `stock-controll-main/src/pages/.../CurrentAccountDetails.jsx` | Modified | Parent `handleRegisterPayment` guard |
| `stock-controll-main/src/components/Modals/CashRegisterClosedModal.jsx` | New | Shared modal reading the error `code`, showing the agreed copy + the right recovery action per case |
| `stock-controll-main/src/pages/SalesDashboard.jsx` | Modified | Owns `activeTab` — the only place that can route "ir a abrir caja" to the register tab from any sibling screen |
| `stock-controll-main/src/pages/sales/NewSale.jsx` | Modified | Replace the generic `alert()` on a sale-create failure with the shared modal when the error carries a recognized `code` |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| A sale rejected mid-close surfaces as a raw backend string in the POS, confusing the cashier at the worst moment | Medium | `NewSale.jsx:360` already `alert()`s `error.response?.data?.message`, so the 409 reaches the user. The message must name the cause and the action ("la caja se cerró; abrí una nueva caja y repetí la venta"), not just "409". Wording is a deliverable, not an afterthought. |
| An existing caller assumes `closeRegister` never throws a conflict | Low | Audited: the only callers are `cajaController.closeRegister` (already forwards `error.status`) and `tests/scenarios/movement-validation.test.js:143`, which calls it directly on a non-contended register — unaffected, but must be re-run. |
| Ordering the status flip before the totals snapshot changes which sales land in `expectedAmount` for a close that was previously "successful" | Medium | That change is the fix, not a regression. Both new concurrency tests assert the invariant (cash in drawer == cash in totals) rather than a specific interleaving. |
| Double-click on "Abrir Caja" can still create a second `OPEN` register from a *second terminal* — the frontend guard only covers one tab | Medium | `openRegister` (`cajaServices.js:56-72`) has the same unguarded pre-check shape. Not in the decision record → see Open Questions #1; the frontend guard ships regardless and removes the single-user double-click path. |
| Concurrency tests look flaky because JS interleaving is non-deterministic | Low | Same note as Level 1 design: the second conditional `UPDATE` blocks on the row lock and re-evaluates against the committed value. Outcome is deterministic because the guard lives in the DB. Do not "fix" as flaky. |

## Open Questions — Resolved (addendum, 2026-11-03)

1. **`movimientosServices.createMovement` / `currentAccountServices.registerPayment`**: resolved — folded into scope (item 3 above). No tradeoff; same root cause, same fix shape.
2. **`openRegister` double-open**: resolved — product owner confirmed folding it into this change (item 4 above) rather than deferring. DB-level partial unique index, not application-only.
3. **User-facing copy for the mid-close sale rejection**: resolved — product owner confirmed the wording: *"La caja se cerró mientras confirmabas la venta. Abrí la caja de nuevo para continuar."*, surfaced with a button that goes directly to opening a register, not just an alert. Applies to the three stale-binding 409 paths (sale, movement, CC payment). **Correction from the design phase**: a rejected *open* (the register was already open — see Open Question #2 below) is a different case — "abrir caja" is nonsensical when one is already open; that case gets its own copy + an "Actualizar" action instead, not the same button.

## Open Questions — Resolved (addendum 2, from design phase, 2026-11-03)

1. **Error body needs a `code` field, not just `status`**: resolved — approved. The locked "Controller changes: None needed" row stays true for status forwarding; `code` (`CASH_REGISTER_ALREADY_CLOSED` / `CASH_REGISTER_ALREADY_OPEN` / a shared code for the three stale-binding sites) is an additive field so the frontend can pick the right recovery action without substring-matching the Spanish message. See the Approach table.
2. **Frontend scope is 6 files, not 3**: resolved — approved. `CashRegisterClosedModal.jsx` (new), `SalesDashboard.jsx`, and `NewSale.jsx` join the original 3 — all three are direct, necessary consequences of the UX already agreed in addendum 1, not scope creep. See Affected Areas.
3. **"Rejected open" recovery action**: resolved — see the correction above. "Actualizar" (refresh to see the register someone else already opened), not "abrir caja".
4. **Test script count**: resolved — 4 concurrency scripts + 1 integrity script (`caja-open-index.test.js`, asserting the partial unique index survives a future migration regeneration), not the 3 originally named. See Affected Areas.

## Rollback Plan

Mostly code-only, with one schema change. Backend: revert `services/cajaServices.js`, `services/salesServices.js`, `services/movimientosServices.js`, `services/currentAccountServices.js` (each reverts independently; a guard at one site is harmless without the others). The partial unique index on `CashRegister` needs its own migration to drop — before treating that rollback as trivial, run the pre-flight `GROUP BY storeId HAVING count(*) > 1` check (also mandatory before the forward migration, per design) to confirm no two simultaneously-open registers exist for any store; if the index is ever rolled back after real stores start using the system, that check stops being a formality. Frontend: revert the six component files — purely additive local state plus one new modal and a tab-routing change, no contract change to existing props. New test files can be deleted with their `tests/run-all.js` entries. No data repair possible or needed.

## Dependencies

- Level 1 (`2026-11-02-money-stock-integrity`) merged and archived — supplies `utils/money.js`, the `status`-carrying error convention, and `res.status(error.status || 400)` in `cajaController.js`.
- Frontend changes live in the `stock-controll-main` repo; backend and frontend ship as a matched pair but neither blocks the other.

## Success Criteria

- [x] Two concurrent `POST /api/caja/close` on the same register: exactly one succeeds, the other is rejected with `status === 409`; the persisted `closingAmount` / `expectedAmount` / `difference` / `observation` are the winner's, never silently overwritten.
- [x] A sale committed in the exact close window is either counted in `expectedAmount` (sale wins) or rejected with 409 (close wins) — never both charged to the customer and excluded from the close's totals.
- [x] No `order` row exists with a `cashRegisterId` pointing at a register whose `closedAt` is earlier than the order's `createdAt`.
- [x] A close on a drawer whose physical cash matches its sales reports `difference === 0` even under concurrent sale traffic.
- [x] `closeRegister` on an already-`CLOSED` register returns 409 with a message naming the cause, and `cajaController` forwards that status unchanged.
- [x] Double-clicking "Abrir Caja", "Forzar Cierre", the movement `ConfirmModal`, and `RegisterPaymentModal`'s submit each produce exactly ONE request; buttons are visibly disabled while in flight.
- [x] A manual cash movement (`createMovement`) or a cash CC payment (`registerPayment`) committed in the exact close window is either counted in `expectedAmount` or rejected with 409 — same invariant as the sale case.
- [x] Two terminals racing to open a register for the same store: exactly one succeeds, the other is rejected with 409 — never two `OPEN` registers for the same store.
- [x] A rejected sale/movement/payment shows the agreed copy ("La caja se cerró mientras confirmabas la venta. Abrí la caja de nuevo para continuar." adapted per action) with a button that goes directly to opening a register; a rejected *open* shows its own copy with an "Actualizar" action instead — neither case is a bare error string.
- [x] `tests/run-all.js` exits 0 with the three new concurrency scripts registered, and `tests/scenarios/movement-validation.test.js` still passes.
