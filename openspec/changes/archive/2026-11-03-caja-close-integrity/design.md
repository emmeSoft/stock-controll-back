# Design: Cash-Register Close Integrity (Level 2)

## Technical Approach

Level 1 established the idiom; this change does **not** invent a second one. It extends the
concurrency ring to a fifth resource and promotes one row to a mutex:

> **The `CashRegister` row IS the lock.** Every operation that binds money to a register
> (`order`, `cashMovement`) must take an exclusive lock on that register row *before* it
> writes anything, by re-asserting `status = 'OPEN'` through the same conditional-write +
> `count === 0` guard Level 1 uses for stock and balance. `closeRegister` takes the same lock
> by flipping `status` to `'CLOSED'`, and only *then* reads the totals snapshot.

That single sentence settles the invariant. A close either (a) waits behind an in-flight
cash-binding transaction and therefore sees its committed row in the snapshot, or (b) wins the
lock and every later binder is rejected with 409 before it can create a row. There is no third
outcome, and the arbitration lives in Postgres, not in JS timing.

Three rings, as in Level 1:

1. **Lock ring** — one helper, `cajaServices.assertRegisterOpen(tx, registerId, message)`, is the
   ONLY place the register guard is written. Four call sites consume it; `closeRegister` writes
   the mirror-image flip inline because its guard also carries the state change.
2. **Index ring** — one hand-written partial unique index makes "two OPEN registers per store"
   unrepresentable at the DB level, with a `P2002 → 409` translation so the app contract stays
   house-standard.
3. **Surfacing ring** — one machine-readable `code` on the error body and one shared frontend
   modal turn all four 409s into the agreed copy plus a real action, instead of four alerts.

Everything that is CPU-bound or non-transactional (bcrypt password verification, RBAC checks,
friendly pre-reads) stays **outside** `$transaction`. The register lock is held for DB work only.

---

## Architecture Decisions

### Decision 1: the close window is guarded by a SEPARATE conditional write against `CashRegister`, not folded into the domain write

**Choice**: each of the three cash-binding call sites executes an additional
`tx.cashRegister.updateMany({ where: { id, status: 'OPEN' }, data: { status: 'OPEN' } })` inside
its own transaction. `count === 0` → 409.

**Why not fold it into the domain write** (the design question this change had to settle):
the domain writes target *different tables* — `product.updateMany` for stock,
`currentAccount.updateMany` for balance, `cashMovement.create` for a manual movement. SQL has no
cross-table predicate in `UPDATE ... WHERE` without a correlated subquery, and Prisma's
`updateMany.where` is strictly scoped to the model's own fields plus its relation filters (which
compile to subqueries in the *read* path, not to a lock on the parent row). A `product` row and a
`CashRegister` row simply cannot be guarded by one statement. Folding is not a tradeoff we
rejected — it is not expressible.

**Why a no-op `data: { status: 'OPEN' }` self-write** rather than a read:

| Option | Verdict |
|---|---|
| `findUnique` / `findFirst` re-read inside the tx | **Rejected** — this is the Level 1 bug shape verbatim. Under READ COMMITTED a plain `SELECT` takes no row lock and sees a snapshot taken at statement start; a close committing one millisecond later is invisible. It would look like a fix and guard nothing. |
| `SELECT ... FOR UPDATE` via `tx.$queryRaw` | **Rejected** — semantically equivalent (Postgres re-checks the qual after the lock wait and drops non-matching rows), but it introduces raw SQL and a *second* concurrency mechanism into a codebase that has exactly one. Its only advantage is avoiding one dead tuple per sale, which is irrelevant at POS volume. |
| Postgres advisory locks | **Rejected** — already rejected in the Level 1 design and in this proposal's decision table. Lock identity lives outside the data model and is invisible to anyone reading the schema. |
| **No-op conditional `updateMany` + `count === 0`** | **Chosen** — byte-for-byte the Level 1 idiom, one helper, already understood by whoever reads `salesServices` PASO 10. Postgres does not optimize away a same-value `UPDATE`: it writes a new tuple version and takes the row lock. |

**Mechanics that make it correct** (same note as Level 1 — do not "fix" as flaky): under READ
COMMITTED, when `UPDATE ... WHERE status = 'OPEN'` finds the row already locked by an uncommitted
transaction, it **blocks**, and after that transaction commits it re-evaluates the predicate
against the *new* row version (EvalPlanQual). If the close committed in the meantime, the row no
longer matches, it is skipped, and `count === 0`. Determinism comes from the DB, not from
`Promise` ordering.

**Isolation level stays the connection default (READ COMMITTED).** Do NOT pass
`{ isolationLevel: 'Serializable' }` to these transactions: it converts clean blocking into
`40001` serialization failures that surface as raw 500s and would need retry logic the house
contract does not have.

### Decision 2: lock ordering — the register guard is the FIRST write of every guarded transaction

This is the non-obvious half of Decision 1, and getting it wrong produces deadlocks rather than
bugs.

Inserting an `order` or a `cashMovement` takes an implicit **`FOR KEY SHARE`** lock on the
referenced `CashRegister` row (FK enforcement). If the guard ran *after* that insert, the same
transaction would have to **upgrade** `FOR KEY SHARE` → `FOR NO KEY UPDATE` on a row a concurrent
sibling already holds in `FOR KEY SHARE` — the textbook lock-upgrade deadlock. Two concurrent
manual movements would deadlock on the same register, Postgres would abort one with `40P01`, and
the user would get a raw 500 instead of our 409. So:

> **Rule: `assertRegisterOpen` runs before any statement that writes a row referencing the
> register, and before any other lock the transaction will take.**

Resulting global lock order, consistent across all five sites and therefore acyclic:

```
CashRegister  <  DiscountRule  <  CurrentAccount  <  Product
```

| Transaction | Locks taken, in order |
|---|---|
| `salesServices.create` | CashRegister (guard) → DiscountRule (PASO 4) → CurrentAccount (PASO 8b) → Product (PASO 10) |
| `currentAccountServices.registerPayment` | CashRegister (guard) → CurrentAccount → `CashMovement` insert |
| `movimientosServices.createMovement` | CashRegister (guard) → `CashMovement` insert |
| `cajaServices.closeRegister` | CashRegister (flip) only |

No cycle exists, so no deadlock is possible between any pair of these transactions.

**Exact placement inside `salesServices.create`** matters for a second reason: it must sit
**after** PASO 1's product read + friendly pre-check and **before** PASO 3/4 (the first write).
Placing it at the very top of the transaction would make a sale that loses the register race
block *before* reading stock, so the existing `tests/concurrency/sale-race.test.js` would see the
loser fall into the friendly `Stock insuficiente` pre-check (plain `Error`, 400) instead of the
atomic stock guard's 409 — silently breaking a Level 1 regression test. After PASO 1, the
barrier-driven stock race still resolves exactly as it does today.

**Accepted cost, stated plainly**: all cash-binding operations at one register now serialize on
that register's row for the duration of their transaction. At this scale — one OPEN register per
store, human-paced POS traffic, transactions that are tens of milliseconds of DB work — that is
not a throughput problem, it is *the mechanism*: serialization is exactly what makes "the close's
snapshot is complete" a true statement. The mitigation is keeping bcrypt, RBAC and all friendly
pre-reads outside the transaction, which this design does.

**Do not rely on the FK side effect alone.** The `FOR KEY SHARE` lock an `order` insert takes
does block a concurrent status flip — but only in that direction. It does nothing to stop a sale
that starts *after* the close committed from inserting an order bound to a CLOSED register. The
explicit guard is what closes the other half.

### Decision 3: `closeRegister` flips FIRST, snapshots SECOND, writes totals THIRD

```js
const closeRegister = async (data, user) => {
  // password / storeId checks stay OUTSIDE the tx — bcrypt.compare is ~100ms of CPU and must
  // never run while holding the register lock.
  // ...

  // Friendly, non-racing pre-check (unchanged message, unchanged 400).
  // `select: { id: true }` is deliberate: it makes deriving totals from a pre-read impossible
  // by construction.
  const target = await prisma.cashRegister.findFirst({
    where: { storeId: user.storeId, status: 'OPEN' },
    select: { id: true },
  });
  if (!target) throw new Error('No hay ninguna caja abierta en esta tienda para cerrar.');

  return await prisma.$transaction(async (tx) => {
    // (1) FLIP FIRST — conditional write, exactly-once, takes the exclusive row lock.
    //     `closedByUserId` is a scalar: updateMany does not accept `closedByUser: { connect }`.
    const { count } = await tx.cashRegister.updateMany({
      where: { id: target.id, status: 'OPEN' },
      data: { status: 'CLOSED', closedByUserId: user.id, closedAt: new Date() },
    });
    if (count === 0) {
      throw Object.assign(
        new Error('La caja ya fue cerrada desde otra terminal. Actualizá la pantalla para ver el cierre vigente.'),
        { status: 409, code: 'CASH_REGISTER_ALREADY_CLOSED' }
      );
    }

    // (2) POST-WRITE re-read — updateMany returns only { count }. openingAmount comes from
    //     HERE, never from the pre-read. Same rule as Level 1's previousStock / balanceAfter.
    const register = await tx.cashRegister.findUnique({ where: { id: target.id } });

    //     Snapshot AFTER the flip. Any binder that already holds the lock has committed
    //     (it is why this tx was allowed to proceed); any binder that has not will be
    //     rejected with 409. Neither can land between these two statements.
    const orders    = await tx.order.findMany({ where: { cashRegisterId: target.id, status: { not: 'CANCELLED' } }, include: { orderPayments: true } });
    const movements = await tx.cashMovement.findMany({ where: { cashRegisterId: target.id } });

    // ... existing Decimal arithmetic, verbatim, reading register.openingAmount ...

    // (3) Totals write — a plain `update` is safe: this tx already holds the exclusive lock
    //     and already proved it is the exactly-once winner. It returns the full row, which is
    //     the contract tests/scenarios/movement-validation.test.js:143-155 asserts against
    //     (`closed.expectedAmount`, `closed.difference`).
    return await tx.cashRegister.update({
      where: { id: target.id },
      data: { closingAmount, expectedAmount, difference, observation },
    });
  });
};
```

**Why flip-then-snapshot and not snapshot-then-flip**: snapshotting first reproduces audit
finding #3 exactly — the read sees a consistent-but-stale set, then a sale commits, then the flip
lands, and the sale's cash is physically in the drawer but missing from `expectedAmount`.
Flipping first makes the lock the fence: nothing can commit into this register after the flip,
and everything that could commit before it already has.

**Why two writes and not one**: `expectedAmount` is a function of the snapshot, and the snapshot
is only trustworthy *after* the flip. One statement cannot both take the fence and depend on what
the fence excluded.

### Decision 4: the partial unique index is hand-written raw SQL, and `P2002` becomes the house 409

**Prisma cannot express this.** Verified against the PSL surface in Prisma 6.19.1: `@@unique`
accepts `fields`, `name`, `map`, `length`, `sort`, and `clustered` — there is no predicate /
`where` argument, and filtered (partial) indexes remain unimplemented in the schema language.
Same situation Level 1 hit with `CHECK` constraints, same remedy: a separate, hand-written
migration that is never folded into a generated baseline.

`prisma/migrations/<ts>_cashregister_one_open_per_store/migration.sql`:

```sql
-- Hand-written migration (NOT generated by `prisma migrate dev`).
-- Prisma's schema language cannot express PARTIAL (filtered) unique indexes — `@@unique`
-- has no predicate argument as of Prisma 6.19.1 — so this index is maintained manually,
-- separate from the generated baseline. Same mechanics as _stock_non_negative.
--
-- WARNING, stronger than the CHECK case: indexes ARE part of Prisma's managed surface.
-- A future `prisma migrate dev` compares the shadow DB (which replays this file) against
-- schema.prisma, finds an index the PSL does not declare, and WILL emit a
-- `DROP INDEX "CashRegister_one_open_per_store";` line in the generated migration.
-- That line MUST be deleted by hand. tests/integrity/caja-open-index.test.js is what
-- catches you if you forget.
CREATE UNIQUE INDEX "CashRegister_one_open_per_store"
  ON "CashRegister" ("storeId")
  WHERE "status" = 'OPEN';
```

Table and column identifiers are quoted PascalCase/camelCase to match the baseline
(`CREATE TABLE "CashRegister"`, `"storeId"`, `"status"`) — this model has no `@@map`.

**Survival mechanics**, three layers, same as the Level 1 CHECK, but layer 3 carries more weight
here because layer 1's argument is weaker (Prisma ignores CHECK constraints; it does *not* ignore
indexes):

1. Its own migration file → replays on every `migrate reset` / `migrate deploy`.
2. A comment above `model CashRegister` in `schema.prisma` naming the index and its migration.
3. `tests/integrity/caja-open-index.test.js` queries `pg_indexes` for the index name **and**
   asserts a raw second-OPEN insert is rejected. This is the only thing that catches either
   failure mode (a regenerated baseline omitting it, or a `migrate dev` silently dropping it).

**Application layer — `openRegister`**: a `create` cannot be a conditional write, so the
translation is a narrow catch, not a guard:

```js
  // Friendly, non-racing pre-check — unchanged message, unchanged 400.
  const existingOpen = await prisma.cashRegister.findFirst({
    where: { storeId: user.storeId, status: 'OPEN' }, select: { id: true },
  });
  if (existingOpen) throw new Error('Ya existe una caja abierta en esta tienda.');

  // No $transaction: a single INSERT is already atomic, and the index is the arbiter.
  try {
    return await prisma.cashRegister.create({ data: { /* unchanged */ } });
  } catch (e) {
    // P2002 = unique violation (PG 23505). The only unique constraint a CashRegister insert
    // can violate is this index — the PK is a cuid. `e.meta.target` is logged for diagnostics
    // rather than matched on, because Prisma reports raw-SQL index names inconsistently
    // across versions for indexes absent from the PSL.
    if (e.code === 'P2002') {
      console.warn('[openRegister] P2002 target:', e.meta?.target);
      throw Object.assign(
        new Error('Otra terminal abrió la caja de esta tienda hace un instante. Actualizá la pantalla para operar sobre la caja vigente.'),
        { status: 409, code: 'CASH_REGISTER_ALREADY_OPEN', cause: e }
      );
    }
    throw e;
  }
```

### Decision 5: the shared guard helper lives in `cajaServices`, exported, with no new coupling

```js
// services/cajaServices.js
/**
 * Re-asserts that `registerId` is still OPEN, and holds an exclusive row lock on it for the
 * remainder of `tx`. MUST be the first write of the transaction (see design Decision 2:
 * running it after an order/cashMovement insert forces a FOR KEY SHARE -> FOR NO KEY UPDATE
 * upgrade and can deadlock two concurrent binders).
 *
 * The no-op `status: 'OPEN'` write is deliberate: Postgres does not optimize a same-value
 * UPDATE away, so it takes the lock and creates a new row version while changing nothing.
 * A findFirst here would guard nothing — it takes no lock under READ COMMITTED.
 */
const assertRegisterOpen = async (tx, registerId, message) => {
  const { count } = await tx.cashRegister.updateMany({
    where: { id: registerId, status: 'OPEN' },
    data:  { status: 'OPEN' },
  });
  if (count === 0) {
    throw Object.assign(new Error(message), { status: 409, code: 'CASH_REGISTER_CLOSED' });
  }
};
```

`salesServices`, `movimientosServices` and `currentAccountServices` already
`require('./cajaServices')` for `getCurrentRegister`; `cajaServices` requires none of them. No new
dependency, no cycle.

**No post-guard `findUnique` is needed at these three sites.** Level 1's "two consequences, both
mandatory" rule exists because `updateMany` returns only `{ count }` and history rows must derive
their values from the post-write state. Here nothing is derived from the register: the sale binds
`cashRegisterId` (an id, not a value), and movement/payment bind the same id. The guard's
contract is "this id is OPEN and will stay OPEN until my commit", which the lock delivers without
reading anything back. The one site that *does* need the post-write read is `closeRegister`,
which derives `openingAmount` and returns the row — and it does the `findUnique` (Decision 3,
step 2). The rule is honored, not waived.

### Decision 6: guard shape per call site

| Site | Guard | Position | `count === 0` message / code |
|---|---|---|---|
| `cajaServices.closeRegister` | `updateMany({ where: { id, status: 'OPEN' }, data: { status: 'CLOSED', closedByUserId, closedAt } })` | statement 1 of the new `$transaction`; snapshot + totals follow | `'La caja ya fue cerrada desde otra terminal. Actualizá la pantalla para ver el cierre vigente.'` / `CASH_REGISTER_ALREADY_CLOSED` |
| `cajaServices.openRegister` | none — partial unique index; `create` in try/catch, `P2002` → 409 | no transaction (single INSERT) | `'Otra terminal abrió la caja de esta tienda hace un instante. Actualizá la pantalla para operar sobre la caja vigente.'` / `CASH_REGISTER_ALREADY_OPEN` |
| `salesServices.create` | `assertRegisterOpen(tx, currentRegister.id, msg)` | after PASO 1 read + pre-check, **before** PASO 3/4 (first write) | `'La caja se cerró mientras confirmabas la venta. Abrí la caja de nuevo para continuar.'` / `CASH_REGISTER_CLOSED` |
| `movimientosServices.createMovement` | `assertRegisterOpen(tx, currentRegister.id, msg)` | statement 1 of a **new** `$transaction` wrapping the existing `cashMovement.create` | `'La caja se cerró mientras confirmabas el movimiento. Abrí la caja de nuevo para continuar.'` / `CASH_REGISTER_CLOSED` |
| `currentAccountServices.registerPayment` | `assertRegisterOpen(tx, currentRegister.id, msg)` | statement 1 of the existing `$transaction`, **before** the `currentAccount.updateMany` balance guard | `'La caja se cerró mientras confirmabas el pago. Abrí la caja de nuevo para continuar.'` / `CASH_REGISTER_CLOSED` |

`createMovement` is the only site that gains a transaction it did not have
(`movimientosServices.js:23-35` is a bare `prisma.cashMovement.create`). That is required for the
guard to mean anything — and it is also what makes the test barrier (which patches
`$transaction`) able to reach it.

The existing unlocked `getCurrentRegister` pre-reads at `salesServices.js:144`,
`movimientosServices.js:7` and `currentAccountServices.js:280` all **stay**: fast, friendly 400 in
the non-racing case, exactly like Level 1's `stock < qty` and `amount > balance` pre-checks.

### Decision 7: the 409 reaches the UI as `{ message, code }`, and the frontend needs more than the submit guards

`NewSale.jsx:360` is a blind `alert(error.response?.data?.message)`. The message alone *does*
reach the user — but the locked copy requires **"a button that goes directly to opening a
register"**, and a button requires the frontend to know *which* 409 it received. Pattern-matching
Spanish prose to decide whether to render a navigation button is not a contract; it is a bug
waiting for a copy edit.

**Choice**: carry a machine-readable discriminator on the error and forward it in the response
body.

```js
// controllers/{caja,sales,movimientos,currentAccount}Controller.js — catch blocks
// `error.status` is the house marker for a deliberate, thrown-by-us error. Gating on it keeps
// Prisma's own `.code` (P2002, P2025, ...) from leaking into the response body.
const code = error.status ? error.code : undefined;
res.status(error.status || 400).json({ message: error.message, ...(code && { code }) });
```

Three codes, because the useful action differs:

| `code` | Raised by | Frontend action |
|---|---|---|
| `CASH_REGISTER_CLOSED` | sale / movement / CC payment | **"Abrir caja"** → navigate to the register tab |
| `CASH_REGISTER_ALREADY_CLOSED` | a close that lost to another close | **"Actualizar"** → refetch |
| `CASH_REGISTER_ALREADY_OPEN` | an open that lost to another open | **"Actualizar"** → refetch |

| Option | Verdict |
|---|---|
| Message string only, frontend substring-matches | **Rejected** — couples UI behavior to Spanish copy; the next wording tweak silently removes the button. |
| On any 409, frontend probes `GET /api/caja/current` and infers | **Rejected as the primary path, retained as the fallback** — needs zero backend contract change, which is its only virtue. Costs an extra round trip on the error path, misclassifies if a register was reopened in between, and cannot distinguish a lost-close from a lost-sale. Documented here so that if the controller change is refused (see Open Question 1) there is a known plan B. |
| **`code` field on the error body** | **Chosen** — additive and backwards compatible (existing consumers read `message` and ignore unknown keys), explicit, no extra request, survives copy edits. |

**Frontend wiring**, one shared component rather than four inline modals:

- **NEW** `src/components/Modals/CashRegisterClosedModal.jsx` — wraps the existing
  `ConfirmModal` (`message`, `confirmText`, `onConfirm`, `accentColor`); derives label and action
  from `code`. One home for the locked copy.
- `src/pages/sales/SalesDashboard.jsx` — read the initial tab from `useSearchParams()`
  (`?tab=register`). `SalesDashboard` owns `activeTab` (`SalesDashboard.jsx:11`) and renders both
  `<NewSale />` and `<CashRegister />` as siblings with no props, so a URL param is the only
  mechanism that works **both** from inside the dashboard (NewSale) and from another route
  (`/accounts/details/:id`). One mechanism, no prop threading.
- `src/pages/sales/NewSale.jsx` — in the `catch`, replace the blind `alert` with: if
  `status === 409 && data.code` → open the modal; otherwise keep the existing `alert` so no other
  error path changes behavior.
- `src/pages/sales/CashRegister.jsx` — guards (`executeOpen` / `executeClose` /
  `executeMovement`) **plus** the modal for its three 409 codes. Already on the register tab, so
  its confirm action is a refetch.
- `src/components/Modals/RegisterPaymentModal.jsx` + `src/pages/CurrentAccountDetails.jsx` —
  guard plus the modal, confirm action `navigate('/sells?tab=register')`.

Copy, per the locked wording, adapted per action:

| Action | Copy | Button |
|---|---|---|
| Sale | *"La caja se cerró mientras confirmabas la venta. Abrí la caja de nuevo para continuar."* | Abrir caja |
| Movement | *"La caja se cerró mientras confirmabas el movimiento. Abrí la caja de nuevo para continuar."* | Abrir caja |
| CC payment | *"La caja se cerró mientras confirmabas el pago. Abrí la caja de nuevo para continuar."* | Abrir caja |
| Close lost the race | *"La caja ya fue cerrada desde otra terminal. Actualizá la pantalla para ver el cierre vigente."* | Actualizar |
| Open lost the race | *"Otra terminal abrió la caja de esta tienda hace un instante. Actualizá la pantalla para operar sobre la caja vigente."* | Actualizar |

**This is a real scope delta and is flagged, not absorbed** — see Open Questions 1 and 2.

### Decision 8: test strategy — house style, barrier-first, five new scripts

Plain `node`, local `assert()`, registered in `tests/run-all.js`, no framework (Level 1 decision,
unchanged). Determinism comes from the **two-party barrier** established in the
`payment-race.test.js` fix (`payment-race.test.js:47-67`): patch the shared
`db/database.prisma` singleton's `$transaction` so each party increments a counter on entry and
awaits a shared promise released when the counter reaches the party count; restore in `finally`.
No fixed delays — that hack flaked ~40% under load and is not to be reintroduced.

Note on require-cache identity: `salesServices` requires `../db/database.prisma.js` and
`cajaServices` requires `../db/database.prisma` — Node resolves both to the same absolute
filename, so one patch covers both parties. Confirmed before relying on it.

| File | Status | Covers |
|---|---|---|
| `tests/concurrency/caja-close-race.test.js` | New | Barrier(2) over two `closeRegister` calls: exactly one fulfilled, one rejected with `status === 409` and `code === 'CASH_REGISTER_ALREADY_CLOSED'`; the persisted `closingAmount`/`expectedAmount`/`difference`/`observation` are the **winner's**, never overwritten; exactly one row with `status = 'CLOSED'`. |
| `tests/concurrency/sale-vs-caja-close-race.test.js` | New | CASO 1 barrier(2) sale ‖ close, asserting the **invariant** not an interleaving: if the sale is fulfilled its cash is inside the close's `expectedAmount`; if rejected it is 409/`CASH_REGISTER_CLOSED` and **zero** `order` rows exist. CASO 2 (deterministic, close first): a sale against the just-closed register is rejected 409 and creates no order, no stock decrement, no `orderPayment`. CASO 3 (deterministic, sale first): the close's `expectedAmount` includes the sale's cash exactly. Plus the global assertion: no `order` exists whose `createdAt` is later than its register's `closedAt`. |
| `tests/concurrency/cash-movement-vs-caja-close-race.test.js` | New | Same invariant for the other two binders, two cases sharing one fixture set: CASO 1 `movimientosServices.createMovement` ‖ close, CASO 2 `currentAccountServices.registerPayment` ‖ close. Named for what both paths actually write — a `CashMovement` bound to the register — so the name does not lie about its second case. |
| `tests/concurrency/caja-open-race.test.js` | New | Two `openRegister` calls for the same store: exactly one fulfilled, one 409/`CASH_REGISTER_ALREADY_OPEN`, exactly one `status = 'OPEN'` row for the store. **`openRegister` has no `$transaction`**, so the `$transaction` barrier does not reach it — this script patches `svcPrisma.cashRegister.create` with the same two-party barrier instead. Fixtures must store a real `bcrypt.hash(TEST_PASSWORD, 10)` (the pattern in `movement-validation.test.js:49`), since `openRegister` runs `bcrypt.compare` before the race point. |
| `tests/integrity/caja-open-index.test.js` | New | Mirrors `stock-check.test.js`: asserts `CashRegister_one_open_per_store` exists in `pg_indexes` **and** that a raw insert of a second OPEN register for the same store is rejected. The only layer that catches a future baseline regeneration or a `migrate dev` drop. |
| `tests/run-all.js` | Modified | Register all five (async scripts export `main`, per the runner's contract at lines 44-47). |

**Regression re-runs, mandatory before merge:**

- `tests/concurrency/sale-race.test.js` — proves Decision 2's guard placement did not downgrade
  the stock race from 409 to the friendly 400. This is the single most likely way to break
  something while fixing something else.
- `tests/concurrency/payment-race.test.js` — the new register guard now runs ahead of the balance
  guard inside the same transaction; the balance race must still resolve to 409.
- `tests/scenarios/movement-validation.test.js` — calls `closeRegister` directly (line 143) and
  asserts `closed.expectedAmount === 1445.44` / `closed.difference === 0`; the two-write close
  must still return the full row.

Fixture hygiene, house style: each script self-contained (`setupFixtures` / `cleanup`, unique
`__*_test_store__` names), `process.exitCode` on assert failure, `module.exports = main`.

---

## Data Flow

```
                       ┌──────────────── the CashRegister row is the mutex ───────────────┐
                       │                                                                  │
  POST /api/sales ─────┤                                                                  │
  POST /api/movimientos├─> service ─> $transaction ─> assertRegisterOpen(tx, id)  ◄───────┤  FOR NO KEY UPDATE
  POST /api/cuentas/pago                                 │                                 │  (no-op status:'OPEN')
                       │                          count === 0 ──> Error{409, CASH_REGISTER_CLOSED}
                       │                                 │ count === 1  (lock held to commit)
                       │                                 ├─> DiscountRule / CurrentAccount / Product writes
                       │                                 └─> order / cashMovement INSERT  (FK, safe: lock already held)
                       │                                                                  │
  POST /api/caja/close ├─> $transaction ─> updateMany{status:'OPEN' -> 'CLOSED'} ◄────────┤  FOR UPDATE
                       │                        count === 0 ──> Error{409, ALREADY_CLOSED} │  (blocks behind binders,
                       │                        count === 1                                │   fences out later ones)
                       │                            ├─> findUnique      (post-write read)  │
                       │                            ├─> order/cashMovement snapshot        │
                       │                            └─> update{ closing/expected/difference }
                       │                                                                  │
  POST /api/caja/open  └─> create ──> PG 23505 ──> P2002 ──> Error{409, ALREADY_OPEN} ◄───┘  partial unique index
                                                                                              (storeId) WHERE status='OPEN'

  controller: res.status(error.status || 400).json({ message, code? })   // code only when error.status is set
        │
        v
  CashRegisterClosedModal  ──(CASH_REGISTER_CLOSED)──>  "Abrir caja"  ──> /sells?tab=register
                           ──(ALREADY_CLOSED|OPEN)───>  "Actualizar"  ──> refetch
```

---

## File Changes

### Backend (`stock-controll-back`)

| File | Action | Description |
|---|---|---|
| `services/cajaServices.js` | Modify | Export `assertRegisterOpen`; `closeRegister` → `$transaction` with flip-first/snapshot/totals; `openRegister` → `P2002` → 409 |
| `services/salesServices.js` | Modify | `assertRegisterOpen` after PASO 1 pre-check, before PASO 3 |
| `services/movimientosServices.js` | Modify | Wrap `createMovement` in `$transaction`; guard as statement 1 |
| `services/currentAccountServices.js` | Modify | Guard as statement 1 of `registerPayment`'s existing `$transaction`, before the balance guard |
| `controllers/cajaController.js` | Modify | Forward `code` in the error body (gated on `error.status`) |
| `controllers/salesController.js` | Modify | Same, in `createSale` (line 21) |
| `controllers/movimientosController.js` | Modify | Same, in `createMovement` (line 11) |
| `controllers/currentAccountController.js` | Modify | Same, in `registerPayment` (line 72) |
| `prisma/schema.prisma` | Modify | Comment above `model CashRegister` naming the index + its migration |
| `prisma/migrations/<ts>_cashregister_one_open_per_store/migration.sql` | Create | Hand-written partial unique index |
| `tests/concurrency/caja-close-race.test.js` | Create | — |
| `tests/concurrency/sale-vs-caja-close-race.test.js` | Create | — |
| `tests/concurrency/cash-movement-vs-caja-close-race.test.js` | Create | — |
| `tests/concurrency/caja-open-race.test.js` | Create | — |
| `tests/integrity/caja-open-index.test.js` | Create | — |
| `tests/run-all.js` | Modify | Register the five new scripts |

### Frontend (`stock-controll-main`)

| File | Action | Description |
|---|---|---|
| `src/components/Modals/CashRegisterClosedModal.jsx` | Create | Shared 409 modal over `ConfirmModal`; owns the locked copy and the per-code action |
| `src/pages/sales/SalesDashboard.jsx` | Modify | Initial tab from `?tab=register` via `useSearchParams` |
| `src/pages/sales/NewSale.jsx` | Modify | 409 + `code` → modal instead of blind `alert` (line 360); other errors unchanged |
| `src/pages/sales/CashRegister.jsx` | Modify | `isProcessing` guards on `executeOpen`/`executeClose`/`executeMovement` + close the movement `ConfirmModal` before awaiting + 409 modal |
| `src/components/Modals/RegisterPaymentModal.jsx` | Modify | `isSubmitting` guard + disabled submit |
| `src/pages/CurrentAccountDetails.jsx` | Modify | Parent `handleRegisterPayment` guard + 409 modal navigating to `/sells?tab=register` |

---

## Migration / Rollout

**Pre-flight, mandatory — the migration can fail on apply.** `CREATE UNIQUE INDEX` on existing
data errors out if any store already has two OPEN registers (entirely plausible: the current DB
holds faker-seeded data, and the pre-change code had no guard at all). Run first, against the
target DB:

```sql
SELECT "storeId", count(*) FROM "CashRegister" WHERE "status" = 'OPEN' GROUP BY 1 HAVING count(*) > 1;
```

Zero rows → apply. Non-zero rows → remediate before applying (close the extras, or, per Level 1's
established context that this data is disposable, `migrate reset` + `node prisma/seedRbac.js` +
`npx prisma db seed`). Do not apply the migration over a dirty state and hope.

**Order**: pre-flight query → `prisma migrate dev` (local) → full `node tests/run-all.js` → apply
on Supabase over the **direct** connection (port 5432, not the 6543 pooler — the pooler breaks
DDL, per Level 1) → deploy backend → deploy frontend. Backend and frontend ship as a matched pair
but neither blocks the other: the frontend's modal is inert without the `code` field (it falls
through to the existing `alert`), and the backend's 409s are readable without the modal.

---

## Rollback

Three independent units; the proposal's "code-only, no schema change" line is superseded by the
addendum that added the index.

1. **Backend service guards** — revert `services/*` and `controllers/*`. Pure code. Each guard is
   harmless without the others (Level 1 property, preserved).
2. **Frontend** — revert the six files. Additive local state and one new component; no contract
   change.
3. **The partial unique index — a schema change that needs its own revert step.** Prisma has no
   down-migrations, so rolling back is either deleting the migration directory and running
   `DROP INDEX IF EXISTS "CashRegister_one_open_per_store";` against the DB, or a full
   `migrate reset` (which also wipes data and requires `node prisma/seedRbac.js` before
   `npx prisma db seed`, per Level 1's seed gotcha).

**Is dropping it safe?** Yes, and confirmed rather than assumed:

- Dropping a unique index never destroys or rewrites data; it only stops *future* inserts from
  being rejected.
- No code depends on the index existing for correctness of a read: `getCurrentRegister` and both
  pre-checks use `findFirst`, which keeps working with zero, one, or many OPEN registers. The
  only dependent path is `openRegister`'s `P2002` catch, which simply becomes unreachable.
- Nothing in the app *requires* two simultaneously-OPEN registers per store: the pre-change code
  already treated that state as an error (`cajaServices.js:60-62`, 'Ya existe una caja abierta'),
  and `closeRegister` / `getCurrentRegister` / `getRegisterHistory` all `findFirst` a single OPEN
  register, meaning a second one was always invisible and unclosable. The index forbids a state
  the application never supported.

**Ordering rule**: if you revert the code but keep the index, `openRegister` loses the `P2002`
catch and an open-race surfaces as a raw 500. So **drop the index before, or in the same deploy
as, reverting `cajaServices.js`** — never code-first.

---

## Open Questions

- [x] **1. RESOLVED (product owner, 2026-11-03) — approved as recommended.** Controller change for the `code` field vs. the locked "Controller changes: None
  needed" row.** The proposal's decision table locked *"Controller changes — None needed,
  `cajaController.js:19` already does `res.status(error.status || 400)`"*. That rationale is
  scoped to **status forwarding**, which remains true and untouched. But the later addendum
  (Open Question 3, 2026-11-03) locked a UX requirement — a *button*, not just a string — that
  cannot be satisfied reliably without a discriminator in the response body, which is a four-line
  additive change across four controllers. Two locked items are in tension and this design does
  not get to resolve that unilaterally. **Recommended**: approve the `code` field (additive,
  backwards compatible, no new error class, no middleware). **Documented plan B if refused**: the
  `GET /api/caja/current` probe described in Decision 7, with its stated misclassification
  window. Needs a product-owner call before `sdd-tasks`.

- [x] **2. RESOLVED (product owner, 2026-11-03) — approved, the +3 files are necessary, not scope creep.** Frontend scope delta beyond the double-submit guards. The proposal's Affected Areas
  lists three frontend files; satisfying the locked copy-plus-button requirement needs six
  (adding `CashRegisterClosedModal.jsx` as a new shared component, `SalesDashboard.jsx` for the
  `?tab=register` entry point, and `NewSale.jsx`, which the proposal cited only as the *reference*
  pattern, not as a file to modify). Flagged rather than silently absorbed: it is roughly +1 small
  component and two small edits, but it is still scope the proposal did not price.

- [x] **3. RESOLVED (product owner, 2026-11-03) — approved, "Actualizar" instead of "abrir caja" for this one case.** The "rejected open" UX is an interpretation, not the locked copy. Addendum 3 says
  the modal-with-button treatment applies "by the same UX logic" to a rejected open. Literally
  routing that case to a button that opens a register is nonsense — the failure reason *is* that a
  register is already open. This design gives it an "Actualizar" action instead and adapts the
  copy accordingly. Flagged so the product owner can confirm, since it deviates from the literal
  reading of a locked decision even though it follows its intent.

- [x] **4. RESOLVED (product owner, 2026-11-03) — approved, 4+1 scripts as designed.** Test-script count: four concurrency scripts, not three. The proposal names three and
  its success criteria say *"the three new concurrency scripts registered"*. This design adds a
  fourth (`cash-movement-vs-caja-close-race.test.js`) plus one integrity script
  (`caja-open-index.test.js`), because success criteria lines 104 and 105 require coverage the
  three named scripts do not reach, and because folding the movement and CC-payment races into
  the sale script would give it a name that lies about its contents. No tradeoff is believed to
  exist here — recorded for the record, not for debate.

- [x] **5. Can Prisma express the partial unique index?** Resolved: no. Prisma 6.19.1's `@@unique`
  takes `fields`, `name`, `map`, `length`, `sort`, `clustered` — no predicate. Hand-written
  migration, same mechanics as Level 1's CHECK, with the extra warning that indexes (unlike CHECK
  constraints) *are* inside Prisma's managed surface and a future `migrate dev` will try to drop
  this one. See Decision 4.

- [x] **6. Does the close window need a separate `CashRegister` write per call site, or can it
  fold into the existing domain write?** Resolved: separate, because the domain writes target
  other tables and no single SQL statement can guard a `product` row on a `CashRegister` row's
  status. One mechanism for all three sites. See Decision 1.
