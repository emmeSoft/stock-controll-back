# Verification Report — money-stock-integrity (Units 1-8)

**Change**: money-stock-integrity
**Scope**: Units 1-8 (all code units). Unit 9 (deployed Supabase reset) intentionally absent — gated on separate explicit human consent, correctly deferred.
**Branch verified**: `money-stock-integrity-08-excel` (tip, commit `66a75a7`), diffed against `main`.
**Mode**: Standard (apply-progress explicitly records "Mode: Standard (Strict TDD not active for this project)"; tasks.md confirms "Strict TDD is NOT active for this project" — no TDD-evidence table required).
**Date**: 2026-11-02

## Verdict: PASS

All 11 success criteria verified by fresh, passing test execution. No CRITICAL issues found. One minor documentation-wording nit and one informational note (the already-explained Phase 5 checkbox staleness, not re-penalized here).

## Completeness

| Metric | Value |
|--------|-------|
| Units total (code) | 8 |
| Units complete | 8/8 |
| Unit 9 | Not started, correctly deferred, out of scope for this verify pass |
| Tasks (code units 1-8) | 44/44 checked in apply-progress; tasks.md Phase 5 checkboxes stale on disk (known, documented, not re-flagged) |

## Fresh Test Execution

### npm run test:integrity (11 scripts) — ALL PASSED

```
RUNNING: ./money/money.test.js                        PASS
RUNNING: ./money/serializer.test.js                    PASS
RUNNING: ./money/excel-export.test.js                  PASS
RUNNING: ./integrity/stock-check.test.js               PASS
RUNNING: ./concurrency/payment-race.test.js            PASS
RUNNING: ./concurrency/close-race.test.js              PASS
RUNNING: ./scenarios/cc-exact-payment.test.js          PASS
RUNNING: ./concurrency/sale-race.test.js               PASS
RUNNING: ./scenarios/cancel-reverses-debt.test.js      PASS
RUNNING: ./concurrency/stock-edit-race.test.js         PASS
RUNNING: ./scenarios/movement-validation.test.js       PASS

ALL REGISTERED TESTS PASSED
```

### tests/discountEngine/*.test.js (4 scripts, regression) — ALL PASSED

```
node tests/discountEngine/crud-universal.test.js   -> TODOS LOS TESTS DE CRUD UNIVERSAL PASARON (exit 0)
node tests/discountEngine/preview-merge.test.js    -> TODOS LOS TESTS DE MERGE PASARON (exit 0)
node tests/discountEngine/split-rules.test.js      -> TODOS LOS TESTS DE SPLIT PASARON (exit 0)
node tests/discountEngine/universal.test.js        -> TODOS LOS TESTS PASARON (exit 0)
```

15 scripts total, 0 failures, 0 regressions.

## Success Criteria — Verified Against Fresh Test Runs

| # | Criterion | Evidence | Status |
|---|---|---|---|
| 1 | No money-bearing Float in schema; payment model gone | grep -c Decimal prisma/schema.prisma -> 18; remaining Float fields are only maxDiscountPct/percentage/maxPercentage (percentages); grep "model payment" -> no match | PASS |
| 2 | Every money field in every API response is a JSON number, 2dp | serializer.test.js (7 cases incl. nested/array/Date-survival/round-trip JSON.stringify) | PASS |
| 3 | 1234.56 + 789.12 -> exact payment 2023.68 accepted, account closes | cc-exact-payment.test.js | PASS |
| 4 | Two concurrent last-unit sales: one 201, one 409, stock 0, 1 StockHistory row | sale-race.test.js | PASS |
| 5 | Two concurrent payments exceeding balance: one succeeds, one rejected, balance never negative | payment-race.test.js | PASS |
| 6 | Cancelling a fully-credit sale returns balance to pre-sale value with ADJUSTMENT movement | cancel-reverses-debt.test.js + source read (salesServices.js:757-788) | PASS |
| 7 | Manual stock adjustment concurrent with a sale does not erase the sale decrement | stock-edit-race.test.js | PASS |
| 8 | UPDATE product SET stock = -1 rejected by DB | stock-check.test.js (queries pg_constraint, asserts rejection) | PASS |
| 9 | Closing an account with a concurrent payment race is rejected, not silently closed | close-race.test.js + source read (currentAccountServices.js:111-144, atomic updateMany WHERE balance:0) | PASS |
| 10 | createMovement rejects negative/zero/NaN amount | movement-validation.test.js | PASS |
| 11 | Excel export produces numeric cells, not string-concatenated values | excel-export.test.js (CASO 1 proves the fix; CASO 2 proves the bug it fixes is real, not vacuous) | PASS |

Compliance summary: 11/11 success criteria COMPLIANT.

## Spec-to-Code Traceability (spot-checked)

- money-precision / "Decimal-to-Number Serialization": middlewares/decimalSerializer.js deep-walks res.json body; mounted in index.js:90, immediately after express.json() (line 89) and before all 14 route mounts (lines 94-109). Matches design exactly.
- cuentas-corrientes / "Closing an account rejected by a concurrent payment": currentAccountServices.js:111-144 close() - atomic updateMany({ where: { id, status:OPEN, balance:0 } }), count===0 -> 409, re-reads post-write state. Matches scenario verbatim; confirmed green via close-race.test.js.
- sale-cancellation / "Cancelling a fully-credit sale reverses the debt": salesServices.js:757-788 cancel() - inside the same $transaction, creates a new ADJUSTMENT movement (no orderId, since that field is @unique and held by the original SALE movement), decrements balance by originalMovement.debtAmount. Matches scenario verbatim.
- stock-history-integrity / "Non-Negative Stock Constraint": stock-check.test.js queries pg_constraint directly for product_stock_non_negative and asserts a raw UPDATE ... SET stock = -1 throws a check_violation. Matches scenario verbatim.

## Native Decimal-Arithmetic Sweep (adversarial grep, across all 8 touched service/controller files + the 5 Excel handlers)

Grepped for bare +, -, ===, !== directly on balance, amount, price, discountTotal, openingAmount, totalAmount, debtAmount, expectedAmount, closingAmount and similar Decimal-typed identifiers across salesServices.js, currentAccountServices.js, productsServices.js, cajaServices.js, movimientosServices.js, discountService.js, discountEngine/universal/{calculator,evaluator}.js, and the 5 Excel controllers.

No unguarded native Decimal arithmetic found. All candidate hits resolved to false positives on manual read:

- sellerPerformanceController.js:81,161 - b.totalAmount - a.totalAmount in a .sort() comparator: native minus on Prisma.Decimal is safe (ToNumeric coerces via valueOf's numeric-string return, unlike plus which string-concatenates per spec). Consistent with the apply-progress documented distinction for this exact handler.
- salesServices.js:288 (rule.usedUnits + qty > maxUnits), :541 (post.stock + item.quantity), cancel() line 741 (updatedProduct.stock - detail.quantity) - all operate on Int fields (unit counts / stock quantities), not Decimal money fields.
- discountService.js:156 (projectedNominal <= maxAllowedDiscount + 0.01) - both operands are already toNumber()-converted plain JS numbers at that point; native plus is correct here, not a leak.
- productsServices.js:45,191 - string concatenation for barcode generation, not money.

No += or -= accumulators remain on Decimal fields in any of the 8 files (the two real bugs of this class, cajaServices.getAllRegisters totals and salesServices.getById reduce, were already fixed in Units 4/6 per apply-progress, and are absent from a fresh sweep).

## Serialization Boundary Completeness

middlewares/decimalSerializer.js confirmed mounted correctly (see above). Re-verified the "no 6th handler" claim independently: grep -rn "generateExcel(" controllers/ services/ -> exactly 10 call sites. The 5 money-carrying handlers (salesController.exportSales, movimientosController.exportMovements, cajaController.exportRegisters, productsController.exportProducts, sellerPerformanceController.exportPerformance) all call toNumber() on every money field read (confirmed by direct grep -n toNumber in each file). The other 5 (categoriesController, clientController, employeeController, stockHistoryController, suppliersController) were read directly; none carry Decimal fields (stockHistoryController movementAmount/previousStock/currentStock map to Int columns in schema.prisma:268-282, confirmed by direct schema read). No 6th handler exists.

## Git Chain Integrity

git log --oneline <branchN> ^<branchN-1> run for all 8 adjacent pairs: each branch adds exactly its own unit commit(s) on top of the prior unit's tip (01 to 02 adds 7b45be2 only, 02 to 03 adds c76d1c5 only, 03 to 04 adds 748ce44 + ae946b0, 04 to 05 adds f4d7d03, 05 to 06 adds 0d43811, 06 to 07 adds 8fc1d06, 07 to 08 adds 66a75a7). No branch is accidentally based on main directly or missing an expected ancestor.

git branch -r shows no money-stock-integrity branch on any remote. All 8 unit branches plus the tracker are local-only, confirming nothing was pushed and no PR was opened, as required.

git status on the tip branch is clean except the expected, documentation-only untracked openspec/changes/money-stock-integrity/ directory.

## Scope Discipline

- productsServices.update() stock-in-body path: confirmed genuinely untouched - lines 223-225 still do a bare parseInt(cleanData.stock), and lines 247-267 still do a plain read-then-write StockHistory creation with no atomic guard, explicitly commented in the source as OUT OF SCOPE for this change, left exactly as-is per proposal.md's Out of Scope / product-owner decision. Only price validation in the same function was legitimately touched, correctly in scope per item 5 of the proposal.
- Discount engine maxUnits/baseAmount logic (Level 2, explicitly out of scope): diff review of calculator.js/evaluator.js shows maxUnits/baseAmount only appear as pass-through values wrapped in Decimal-safe arithmetic (toNumber(money(baseAmount).times(...)) replacing parseFloat((baseAmount * ...).toFixed(2))), no change to the underlying cap/base-amount logic, consistent with apply-progress's own note that these bugs remain untouched and confirmed still present.
- Cash-register close race conditions (Level 2, explicitly out of scope): cajaServices.js diff shows only Decimal-arithmetic conversion (parseFloat/native +- to money()/round()/sum()); closeRegister() is still a plain prisma.cashRegister.update() with no atomic guard added, confirms the close-race fix was correctly NOT folded in.
- Frontend changes: git diff --stat main money-stock-integrity-08-excel touches zero files under stock-controll-main/frontend paths - confirmed zero frontend changes, as the proposal requires.

## Issues Found

CRITICAL: None.

WARNING: None blocking.

SUGGESTION:
- Minor documentation drift: proposal.md's Approach section states "19 fields / 10 models" for the Decimal migration, while tasks.md's task 1.2 self-corrects to "18 money fields across 9 models" (matching the actual schema, confirmed by grep -c Decimal = 18). Harmless - the code and tests reflect the corrected count; only the original proposal wording is stale. Optional: fix the proposal wording for future readers.
- Informational only (per task instructions, not re-flagged as a defect): tasks.md's Phase 5 section still shows unchecked boxes and no STATUS: COMPLETE header - a known filesystem-sync gap from Unit 5's original apply batch, already explained in apply-progress and confirmed complete by commit f4d7d03 and the passing stock-edit-race.test.js. Verified against actual code/tests, not the stale checkbox state, per the task's own instruction.

## Design Coherence

| Decision | Followed? | Notes |
|---|---|---|
| Prisma.Decimal not decimal.js | Yes | utils/money.js uses Prisma.Decimal exclusively |
| utils/money.js as sole Decimal API surface | Yes | Confirmed via grep sweep, no stray new Prisma.Decimal(...) outside utils/money.js found in the 8 touched files |
| One atomic-guard idiom at all 4 TOCTOU sites | Yes | registerPayment, close, sale create PASO 10, adjustStock all use identical updateMany + count===0 -> 409 shape |
| Single global res.json interceptor | Yes | middlewares/decimalSerializer.js, mounted once |
| Excel exports call money.toNumber() explicitly (interceptor cannot reach them) | Yes | All 5 handlers confirmed |
| CHECK constraint as hand-written, separate migration | Yes | stock-check.test.js queries pg_constraint directly, passes |

## Verification Points — Explicit Confirmation

1. Every success criterion met by fresh test run: CONFIRMED - 11/11, see table above, all tests run fresh in this session.
2. Spec-to-code traceability (2-3 scenarios/capability): CONFIRMED - see Spec-to-Code Traceability section.
3. No native Decimal arithmetic leaked: CONFIRMED - adversarial grep sweep found zero real leaks; all candidate hits resolved to false positives on manual read.
4. Serialization boundary completeness: CONFIRMED - interceptor mount re-verified; "no 6th handler" independently re-confirmed via fresh grep + schema read, not trusted from the prior report.
5. Git chain integrity: CONFIRMED - each branch's unique commits verified against its immediate predecessor; no remote branches exist.
6. Scope discipline: CONFIRMED - update()'s stock-in-body path untouched; no Level-2 logic (maxUnits/baseAmount, close-race, frontend) leaked in.

## Final Verdict

PASS. All 8 implemented units (1-8) meet their spec scenarios with fresh, passing test evidence. No CRITICAL or blocking WARNING issues. Unit 9 is correctly absent pending separate human consent for the destructive Supabase reset, not a defect. Recommend sdd-archive for Units 1-8, with Unit 9 to be run as its own explicitly-consented follow-up.
