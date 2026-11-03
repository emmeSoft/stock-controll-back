# Proposal: Money and Stock Integrity (Level 1)

## Intent

Money is stored as `Float` and every stock/balance guard is a read-then-write (TOCTOU). Audit-confirmed consequences: exact current-account payments rejected and accounts that can never close; concurrent sales driving `product.stock` negative; concurrent payments driving `CurrentAccount.balance` negative (cash accepted that should have been refused); cancelling a credit sale leaving the customer owing a debt that no longer exists; an admin stock edit silently erasing a concurrent sale's decrement.

**Why now**: the database holds only disposable test data — no real customers. Migration history can be reset clean and no careful money-rounding data migration is needed. This window closes with the first real customer.

## Scope

### In Scope

1. **Full `Float` → `Decimal` money migration** (one pass, not partial)
   - 19 fields / 10 models → `Decimal(12,2)`: `order`(amount, amoutPayed, amoutToPaid, discountTotal), `product.price`, `orderDetail.price`, `CashRegister`(opening, closing, expected, difference), `CashMovement.amount`, `OrderPayment.amount`, `CurrentAccount.balance`, `CurrentAccountMovement`(total, paid, debt, balanceAfter), `AppliedDiscount.amount`.
   - Percentages stay `Float` (`DiscountRule.percentage/maxPercentage`, `store.maxDiscountPct`) — not money.
   - Drop the dead `payment` model (schema.prisma:190, zero code references — verified).
   - Decimal.js API (`.plus()`, `.gt()`, `.isZero()`) in `salesServices`, `currentAccountServices`, `cajaServices`, `movimientosServices`, `productsServices`, `discountEngine/universal/{calculator,evaluator}`, `discountService`.
   - Convert Decimal → `Number` (rounded to cents) at the API boundary. **Frontend unchanged.**
2. **`registerPayment` atomicity** — `currentAccountServices.js` ~268: move balance sufficiency from a pre-transaction `if` into a transaction-scoped conditional update (`where: { balance: { gte: amount } }`).
3. **Sale `create` atomic stock** — `salesServices.js` PASO 10 ~492-512: `updateMany({ where: { stock: { gte: quantity } } })`, throw 409 when `count === 0`; `StockHistory` derives previous/current from the post-write value.
4. **Cancel reverses debt** — `salesServices.js` ~675: inside the same `$transaction`, reverse `CurrentAccount` debt via an `ADJUSTMENT` movement (no `orderId` — that field is `@unique` and held by the original movement).
5. **`productsServices.adjustStock()` atomicity** (~269-310): absolute SET → atomic `increment`/`decrement`. **Scope correction (2026-11-02)**: verified the frontend never sends `stock` through the generic `update()` endpoint — `Details.jsx:250` strips it before the PUT, and the only stock-editing UI (`StockAdjustModal.jsx` → `useEntitySave.js:26`) always calls the dedicated `PUT /api/products/:id/stock` with a signed delta, which is `adjustStock()`, not `update()`. So `update()`'s own `stock`-in-body handling is unreachable from the app today; it is explicitly left untouched by this change (see Out of Scope) rather than silently reinterpreted.
6. **`CHECK (stock >= 0)`** on `product.stock` via migration. Business rule confirmed: every product always has stock loaded before it can be sold.
7. **`movimientosServices.createMovement` validation** — reject non-finite or non-positive `amount` (today `parseFloat(amount)` accepts negative/zero/`NaN`, silently skewing `expectedAmount` on cash-register close). Folded in because the file is already touched for Decimal migration.
8. **Excel export money fields** — the design phase found 5 handlers in the Excel-export path (`excelService.js` and friends) that do manual money arithmetic (e.g. `sale.amount + sale.discountTotal`) outside the `res.json` serialization boundary; under Decimal these silently become string concatenation instead of a number in the spreadsheet cell. Convert to `Number` at those 5 points, same root cause as the rest of this change — folded in rather than deferred.

### Out of Scope (each becomes its own later change)

- Discount engine `maxUnits` / `baseAmount` bugs (Level 2)
- Payment tolerance value in `validatePayments`
- Cash-register close race conditions (double-close, false-discrepancy)
- Frontend double-submit guards
- CI / migration-deploy pipeline (fix 7)
- All "hallazgos menores" (console logs, `runningDiscount`, missing `orderBy`, `client.dni` uniqueness, `order.status` enum, `runPipeline` arity)
- **`productsServices.update()`'s `stock`-in-body handling** — unreachable from the current frontend (see item 5 above); deferred to a future deep-cleanup SDD change rather than touched here. Product owner decision: "dejalo, más adelante haré un SDD de limpieza profunda."

## Capabilities

### New Capabilities
- `money-precision`: monetary storage, arithmetic, and API-boundary serialization rules.

### Modified Capabilities
- `cuentas-corrientes`: payment sufficiency becomes a DB-enforced atomic condition; exact-balance close now reachable.
- `sale-cancellation`: cancelling a credit sale MUST reverse the current-account debt in the same transaction.
- `stock-history-integrity`: all stock mutations MUST be atomic; stock can never go negative; history values derive from the post-write state.

## Approach (locked decisions)

| Decision | Chosen | Rejected |
|---|---|---|
| Money type | Full `Decimal(12,2)` everywhere, one pass | Float + integer-cents comparison; Decimal only on `CurrentAccount` |
| Frontend contract | Decimal → `Number` at response boundary | Ship Decimal (serializes as string → silent frontend breakage) |
| Concurrency | DB-level atomic guards (conditional `updateMany`, `increment`/`decrement`) | App-level read-then-`if`; `$transaction` wrapper alone (not safe under READ COMMITTED) |
| Data migration | Reset migration history; no rounding migration | Nightly window with `ROUND()` data migration |
| Negative stock | DB `CHECK` as a second net behind the atomic guards | Application-only enforcement |

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `prisma/schema.prisma` | Modified | 19 fields → Decimal; `payment` model removed |
| `prisma/migrations/` | Removed/New | History reset; new baseline + `CHECK (stock >= 0)` |
| `services/salesServices.js` | Modified | Atomic stock decrement, 409, debt reversal on cancel, Decimal math |
| `services/currentAccountServices.js` | Modified | Atomic payment guard, Decimal comparisons |
| `services/productsServices.js` | Modified | Atomic increment/decrement in `adjustStock` only — `update()`'s `stock`-in-body path is untouched (unreachable from the app; deferred) |
| `services/cajaServices.js` | Modified | Decimal arithmetic only |
| `services/movimientosServices.js` | Modified | Decimal arithmetic + positivity/finite validation on `createMovement` |
| `services/discountService.js`, `discountEngine/universal/*` | Modified | Decimal arithmetic only |
| Controllers / response mappers | Modified | Decimal → Number at boundary |
| `services/excelService.js` (and related export handlers) | Modified | 5 money-math points converted to `Number` before writing spreadsheet cells |
| `stock-controll-main` (frontend) | Untouched | Zero changes by design |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| A missed boundary leaks a raw Decimal (serializes as string) and silently breaks frontend math | High | Centralized serializer + endpoint-level response assertions on every money field |
| `Decimal(12,2)` rounds per-item discount/price values that are currently unrounded floats | Low | Resolved: `HALF_UP` at the boundary, applied uniformly including `AppliedDiscount.amount` |
| Prisma cannot express `CHECK`; raw-SQL migration can be lost on a later `migrate dev` regeneration | Medium | Hand-written migration + a test asserting the constraint exists |
| Native operators (`+`, `<`, `===`) left behind on Decimal values produce silent `NaN`/string concat | Medium | Lint/grep sweep over the 8 listed modules; targeted unit tests per money path |
| New 409 on sale create is an unhandled error path in the POS | Low | Resolved: verified `NewSale.jsx` already surfaces any backend error message via `alert()` |

## Open Questions — Resolved (addendum, 2026-11-02)

1. **`currentAccountServices.close`**: resolved — same atomic pattern as `registerPayment`. The `update` that marks the account closed carries `where: { balance: 0 }` (not a pre-check `if`); count `0` means a concurrent payment moved the balance and the close is rejected. The doc's "snap residue to 0" step is dropped — moot under Decimal.
2. **Scale and rounding mode**: resolved — `Decimal(12,2)` stands for every field, including unit prices; no shop needs sub-cent pricing or more than ~$10B in a single amount. Rounding mode: **`HALF_UP`** everywhere at the API boundary (and in `AppliedDiscount.amount`, previously unrounded at the item layer — now rounded for consistency, no behavior cost since it was audit-trail-only).
3. **Migration reset scope**: resolved — applies to the deployed Supabase database too, not just local/dev. Confirmed by the product owner: the database holds only disposable test data.
4. **New 409 contract**: resolved, no gap — verified `stock-controll-main/src/pages/sales/NewSale.jsx:360` already does `alert(error.response?.data?.message || error.message)` for any sale-create failure regardless of status code. The 409 message surfaces as-is; zero frontend changes needed.
5. **`movimientosServices.createMovement` positivity check**: resolved — **in scope**, added as item 7 above.

## Rollback Plan

- Code: single revert of the change branch (all services are code-only changes).
- Schema: revert `schema.prisma` and re-run the pre-change baseline migration. Safe because the database contains only disposable test data — `prisma migrate reset` + reseed restores a working state with no data loss of record.
- The dropped `payment` model and `CHECK` constraint reappear/disappear with that same baseline; no manual data repair is possible or needed.

## Dependencies

- `decimal.js` (already transitively available via `@prisma/client`; confirm direct dependency during design).
- Authorization to reset the database and migration history (granted by the product owner).

## Success Criteria

- [ ] No money-bearing `Float` remains in `schema.prisma`; `payment` model gone.
- [ ] Every money field in every API response is a JSON `number` rounded to 2 decimals (no strings).
- [ ] Charges of 1234.56 + 789.12 accept an exact payment of 2023.68 and the account closes.
- [ ] Two concurrent sales of the last unit: one 201, one 409, final stock 0, exactly one `StockHistory` row.
- [ ] Two concurrent payments exceeding the balance: one succeeds, one rejected, balance never negative.
- [ ] Cancelling a fully-credit sale returns the balance to its pre-sale value with an `ADJUSTMENT` movement.
- [ ] A manual stock adjustment (`adjustStock`) concurrent with a sale does not erase the sale's decrement.
- [ ] `UPDATE product SET stock = -1` is rejected by the database.
- [ ] Closing a current account whose balance changes mid-request (concurrent payment) is rejected, not silently closed with a nonzero balance.
- [ ] `createMovement` rejects a negative, zero, or `NaN` amount.
- [ ] Exporting an Excel report with money fields produces numeric cells, not string-concatenated values.
