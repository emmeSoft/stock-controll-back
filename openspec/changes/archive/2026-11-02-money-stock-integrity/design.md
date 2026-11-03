# Design: Money and Stock Integrity (Level 1)

## Technical Approach

Three concentric rings, each with exactly ONE implementation site so nothing gets reinvented per-file:

1. **Type ring** — schema `Decimal(12,2)` + `utils/money.js` as the only module that constructs or unwraps a Decimal.
2. **Concurrency ring** — one atomic-guard idiom (conditional write + `count === 0`) applied verbatim at all four TOCTOU sites.
3. **Boundary ring** — one global `res.json` interceptor converts Decimal → Number. Services stay Decimal end-to-end.

## Architecture Decisions

### Decision: Decimal implementation comes from `Prisma.Decimal`, not `decimal.js`

**Choice**: `const { Prisma } = require('@prisma/client')` → `Prisma.Decimal`.
**Alternatives considered**: `npm i decimal.js`.
**Rationale**: Resolves the proposal's "confirm direct dependency". `decimal.js@10.5.0` is a **devDependency** of `@prisma/client` (`node_modules/@prisma/client/package.json:237`), bundled into the runtime and NOT installed top-level — `require('decimal.js')` throws today. Installing it separately would create a *second* Decimal class, and `isDecimal()` checks in the serializer would have to handle both. Zero new dependencies.

### Decision: `utils/money.js` is the single Decimal API surface

**Choice**: New CommonJS module (`module.exports`, matching `services/*` and `utils/cloudinary.js`).

```js
const { Prisma } = require('@prisma/client');
const D = Prisma.Decimal;
const SCALE = 2, MODE = D.ROUND_HALF_UP;

const money     = (v) => new D(v ?? 0);                       // the ONLY `new D(...)`
const round     = (v) => money(v).toDecimalPlaces(SCALE, MODE);
const toNumber  = (v) => round(v).toNumber();                 // the ONLY Decimal → Number
const sum       = (xs, f = (x) => x) => xs.reduce((a, x) => a.plus(money(f(x))), money(0));
const isPositiveAmount = (v) => { try { const d = money(v); return d.isFinite() && d.gt(0); } catch { return false; } };
module.exports = { money, round, toNumber, sum, isPositiveAmount, D };
```

**Rationale**: `isPositiveAmount` is exactly what fix 7 (`movimientosServices.createMovement:24`, currently `parseFloat(amount)`) needs. Native `+ - * / < > ===` on money become **banned** in the 8 touched modules; enforcement is a grep sweep task, not a lint rule (no linter configured).

### Decision: one atomic-guard idiom, reusing the house error convention

The codebase already does `throw Object.assign(new Error(msg), { status: N })` and controllers do `res.status(err.status || 500)` (`currentAccountController.js:10,53,72`). "Clear rejection" needs **no new error type** — just `status: 409`.

| Site | Guarded write | On `count === 0` |
|---|---|---|
| `salesServices.js` PASO 10 (~492) | `tx.product.updateMany({ where: { id, stock: { gte: qty } }, data: { stock: { decrement: qty } } })` | throw 409 **inside** `$transaction` → whole sale rolls back |
| `currentAccountServices.registerPayment` (~279) | `tx.currentAccount.updateMany({ where: { id, status: 'OPEN', balance: { gte: amount } }, data: { balance: { decrement: amount } } })` | throw 409 "el saldo cambió, recargá" |
| `currentAccountServices.close` (~117) | `tx.currentAccount.updateMany({ where: { id, status: 'OPEN', balance: 0 }, data: { status: 'CLOSED', closedAt } })` | throw 409 (pre-check `if` deleted; "snap to 0" step dropped per addendum Q1) |
| `productsServices.adjustStock` (~282) | the caller already supplies a signed delta (`StockAdjustModal.jsx` → `useEntitySave.js:26` → dedicated `PUT /products/:id/stock`, never the generic `update()`); `updateMany({ where: { id, ...storeScope, stock: { gte: -delta } }, data: { stock: { increment: delta } } })` | throw 409 |

**Scope correction (2026-11-02)**: `productsServices.update()`'s own `stock`-in-body handling is OUT of scope for this change — verified the frontend never sends `stock` through that endpoint (`Details.jsx:250` strips it before the PUT). It stays untouched, deferred to a future deep-cleanup SDD change per product-owner decision. Only `adjustStock()` gets the atomic fix above.

Two consequences, both mandatory:

- `updateMany` returns `{ count }`, not the row and no `include`. Every site re-reads with `findUnique` after the guard and derives `StockHistory.previousStock = post.stock + qty` / `balanceAfter` from the **post-write** value — never from the pre-read. This is the exact shape already drafted in `extra-documents/Stock Control.md` §2.
- `salesController.createSale:16` hardcodes `res.status(400)`. It MUST become `res.status(error.status || 400)` or the 409 never reaches the POS.

The cheap pre-read `if (stock < qty)` at `salesServices.js:~171` stays — fast, friendly error in the non-racing case.

### Decision: serialization at a single global `res.json` interceptor

**Choice**: `middlewares/decimalSerializer.js`, mounted in `index.js` right after `app.use(express.json())` and **before** all 14 route mounts.

```js
const deepSerialize = (v) => {
  if (Prisma.Decimal.isDecimal(v)) return toNumber(v);
  if (Array.isArray(v)) return v.map(deepSerialize);
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deepSerialize(x)]));
  }
  return v;
};
module.exports = (req, res, next) => { const json = res.json.bind(res); res.json = (b) => json(deepSerialize(b)); next(); };
```

| Option | Verdict |
|---|---|
| Per-controller response mapping | **Rejected** — 16 controllers / ~60 handlers. The proposal's top risk is "a missed boundary"; this maximizes boundaries. |
| Prisma client extension (`$extends` result) | **Rejected** — converts at the READ boundary, so services receive Numbers and lose Decimal arithmetic entirely. Defeats the change. |
| `Decimal.prototype.toJSON` monkey-patch | **Rejected** — mutates a vendored class globally; leaks into logs and ExcelJS unpredictably. |
| **Global `res.json` interceptor** | **Chosen** — one choke point, zero per-endpoint discipline, services Decimal end-to-end, frontend untouched. |

**Known gap (handle explicitly, the interceptor cannot):** 10 Excel handlers stream through `excelService.generateExcel({ res, ... })` and never call `res.json`. Five carry money and must call `money.toNumber()` while building `data`: `salesController:58-68` (line 63 `sale.amount + sale.discountTotal` becomes **string concatenation** under Decimal), `movimientosController:65`, `cajaController:105`, `productsController:131`, `sellerPerformanceController:178`.

### Decision: migration ordering, and how the CHECK survives

8 existing migrations in `prisma/migrations/`. Sequence:

1. Delete all 8 migration dirs; keep `migration_lock.toml`.
2. Edit `schema.prisma`: 19 fields → `Decimal @db.Decimal(12,2)` (10 models); delete `model payment` (line 190). Percentages stay `Float`.
3. `prisma migrate dev --name baseline_decimal_money` → generated baseline.
4. **Hand-write a SEPARATE migration** `prisma/migrations/<ts>_stock_non_negative/migration.sql`:
   `ALTER TABLE "product" ADD CONSTRAINT "product_stock_non_negative" CHECK ("stock" >= 0);`

**CHECK survival mechanics** (three layers — layer 3 is the one that actually enforces):

1. Its own migration file, never folded into the generated baseline → replays on every `migrate reset` / `migrate deploy`. Because it lives in history it also exists in Prisma's shadow DB, and `migrate diff` leaves CHECK constraints alone (they are outside the PSL surface) rather than dropping them.
2. A comment above `model product` in `schema.prisma` naming the constraint and its migration, so the next person regenerating a baseline sees it.
3. `tests/integrity/stock-check.test.js` queries `pg_constraint` for `product_stock_non_negative` and asserts `UPDATE product SET stock = -1` is rejected. **The real failure mode is not `migrate dev` dropping it — it is a future baseline regeneration silently omitting it.** Only this test catches that.

**Supabase (`stockControll` / `dzrudjirqpszdvxsgjus`)**: same reset per addendum Q3. Run `migrate reset` over the **direct** connection (port 5432), not the pgBouncer pooler (6543) — the pooler breaks DDL and advisory locks.

### Decision: test strategy without a test runner

House convention (`tests/discountEngine/*.test.js`): plain `node <file>`, local `assert(cond, msg)` that `console.error` + `process.exit(1)`. Follow it. Introducing a framework is fix 7, out of scope.

| Layer | File | Covers |
|---|---|---|
| Unit (no DB) | `tests/money/money.test.js` | HALF_UP at 2dp; `sum([1234.56, 789.12])` equals `2023.68`; `isPositiveAmount(-1\|0\|NaN\|Infinity) === false` |
| Unit (no DB) | `tests/money/serializer.test.js` | `deepSerialize` on a nested order payload → every money key is `typeof 'number'`, 2dp; `Date` survives |
| DB integrity | `tests/integrity/stock-check.test.js` | constraint exists; negative stock rejected |
| Concurrency (DB) | `tests/concurrency/{sale,payment,close,stock-edit}-race.test.js` | `Promise.allSettled([a, b])` → exactly one fulfilled, one rejected with `status === 409`; final DB state + exactly one history row |
| Scenario (DB) | `tests/scenarios/{cc-exact-payment,cancel-reverses-debt}.test.js` | the two non-concurrency criteria |

Add `"test:integrity": "node tests/run-all.js"` — a trivial sequential `require` loop exiting non-zero on first failure. DB-backed tests run locally after `migrate reset` + seed; a pre-merge manual gate, not CI (CI is fix 7).

**Do not "fix" these as flaky**: under READ COMMITTED the second `UPDATE ... WHERE stock >= n` blocks on the first transaction's row lock, then re-evaluates the predicate against the committed value. The outcome (one 201 / one 409) is deterministic even though the JS interleaving is not — because the guard lives in the DB, not in `Promise` timing.

## Data Flow

```
request ─> route ─> controller ─> service  [Prisma.Decimal end-to-end]
                                     ├── utils/money.js   (money / round / sum / compare)
                                     └── atomic guard: updateMany({ where: precondition })
                                              count === 0 ──> Error { status: 409 }
                                     │
              res.json(body) <───────┘
                    │
     middlewares/decimalSerializer  (deep walk: Decimal ──> Number, HALF_UP, 2dp)
                    │
                    v
           JSON numbers ──> frontend (UNCHANGED)

  Excel exports bypass res.json ──> controller MUST call money.toNumber()
```

## File Changes

| File | Action | Description |
|---|---|---|
| `utils/money.js` | Create | Sole Decimal API: `money/round/toNumber/sum/isPositiveAmount` |
| `middlewares/decimalSerializer.js` | Create | Global `res.json` deep Decimal → Number |
| `index.js` | Modify | Mount serializer after `express.json()`, before routes |
| `prisma/schema.prisma` | Modify | 19 fields → `Decimal(12,2)`; drop `model payment`; CHECK comment on `product` |
| `prisma/migrations/*` | Delete + Create | Reset history; baseline + `_stock_non_negative` (raw SQL) |
| `services/salesServices.js` | Modify | Atomic stock guard + 409, post-write history, debt reversal on cancel, Decimal math |
| `services/currentAccountServices.js` | Modify | Atomic guards in `registerPayment` and `close`, Decimal comparisons |
| `services/productsServices.js` | Modify | Delta-based atomic `increment` in `adjustStock` only — `update()`'s `stock`-in-body path untouched, out of scope |
| `services/{cajaServices,movimientosServices,discountService}.js`, `discountEngine/universal/{calculator,evaluator}.js` | Modify | Decimal math; `isPositiveAmount` in `createMovement` |
| `controllers/salesController.js` | Modify | `res.status(error.status \|\| 400)`; `toNumber` in Excel mapper |
| `controllers/{movimientos,caja,products,sellerPerformance}Controller.js` | Modify | `toNumber` in Excel mappers |
| `tests/money/*`, `tests/integrity/*`, `tests/concurrency/*`, `tests/scenarios/*`, `tests/run-all.js` | Create | 9 scripts, house `node`-only style |

## Migration / Rollout

Single deploy, code + migration together (the serializer and the Decimal schema are a matched pair). Order: merge → `prisma migrate reset` local → verify test suite → `prisma migrate reset` on Supabase direct connection → reseed → deploy code.

## Rollback

`prisma/seed.js` exists (`package.json` `prisma.seed`) but **throws** if RBAC roles are missing (`seed.js:30-32`). So rollback is three steps, not one:

```
git revert <branch>  &&  npx prisma migrate reset  &&  node prisma/seedRbac.js  &&  npx prisma db seed
```

`migrate reset` does NOT auto-run `seedRbac.js`. Result: a working, fully-populated faker dataset on the pre-change schema — **not** the exact pre-change rows. Acceptable per the proposal (data is disposable), but recorded so nobody expects row-level restoration.

## Open Questions

- [x] **Supabase RLS / grants** — resolved: ran the Supabase security advisor against the project (`dzrudjirqpszdvxsgjus`); zero lints, zero RLS policies. Nothing for `migrate reset` to lose; the app connects as DB owner over a plain Prisma `DATABASE_URL`, no `@supabase/supabase-js` dependency.
- [ ] **`utils/validators.js` is ESM** (`export const`) yet `require`d from `clientServices.js:2` and `employeeServices.js:6` in a CommonJS package (no `"type": "module"`). That should throw at load. Either those routes are already broken or something transpiles. `utils/money.js` will be CommonJS regardless — flagged only because it may be a live bug adjacent to this change. Still unresolved, out of scope for this change.
- [x] **`productsServices.update` delta semantics** — moot: `update()`'s `stock`-in-body path is out of scope for this change entirely (see correction above); only `adjustStock()`, which already receives a signed delta from the UI, is touched. No semantic change to confirm.
- [x] **`order.discountTotal` is `Float?` (nullable)** — resolved: checked the frontend; `SaleDetail.jsx` recomputes `discountTotal` from `appliedDiscounts` and never reads `order.discountTotal` directly, and every other consumer (`DiscountSummaryModal.jsx:49`) already does `?? 0`. `money(null) → 0` is safe, no null/zero distinction exists anywhere in the UI.
