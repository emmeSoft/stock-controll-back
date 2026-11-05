# Design: Cash Change Calculation (Vuelto) — Level 3

## Technical Approach

One invariant carries the whole change:

> **A cash `OrderPayment.amount` is the NET amount applied to the sale. `receivedAmount` and
> `changeAmount` are audit columns beside it, never terms in any drawer formula.**

Everything else follows mechanically. Because the leg stays net, `closeRegister`'s
`expectedAmount` (`cajaServices.js:193-195`) is already correct and must stay **byte-identical** —
the non-change is the deliverable, asserted by a test rather than assumed. Because change is never
a `CashMovement`, no enum widens and no `type === 'INCOME' ? … : …` branch has to be found and
fixed in five frontend files.

Three rings, in the Level 1 / Level 2 idiom:

1. **Predicate ring** — ONE cash-leg predicate, defined once in `salesServices.js`, consumed by
   the shape validator, the sufficiency check and the persistence step. No method-string
   normalization is added.
2. **Validation ring** — shape/presence **before** the transaction (pure CPU, no Decimal);
   sufficiency + change math **inside**, immediately after `validatePayments`, where the leg
   amounts have been proven to sum to the engine's total.
3. **Reporting ring** — per-sale received/change arrive free (every consumer already does
   `include: { orderPayments: true }`); only the shift-level aggregate is new code, and it carries
   its own explicit non-cancelled filter.

---

## Corrections to the proposal's Affected Areas

The proposal was written against a mental model that does not match `main`. Three of its anchors
are wrong, and the design resolves each rather than inheriting it.

| Proposal says | Reality on this branch | Resolution |
|---|---|---|
| `validatePaymentBreakdownAmounts` exists in `services/discountEngine/universal.js`, "already called at `salesServices.js:103`" | **That function does not exist anywhere in the repo**, and `services/discountEngine/universal.js` is not a file — the module is `services/discountEngine/universal/{index,evaluator,calculator}.js`, exporting only `runUniversalPipeline`, `evaluateUniversal` and the calculator helpers. `salesServices.js:103` is a blank line inside the client pre-check block. | New local helper `validateCashReceivedShape` in `salesServices.js`, next to `validatePayments`. See Decision 2 — a cash-received concern does **not** belong in the discount engine regardless. |
| The `validatePayments` tolerance "is now capped at `$0.50` (sibling PR, merged separately)" | **Not merged here.** `salesServices.js:46` still reads `D.max(money(0.01), total.times(0.001))` — uncapped 0.1%. The same uncapped idiom repeats at line 374 for the non-CC leg and line 222 for price integrity. | Out of scope, unchanged, and **irrelevant to this change**: the `receivedAmount` check is zero-tolerance and self-contained (Open Question #1). Flagged so nobody assumes the cap landed. |
| `posStore.js` `addPayment` / `updatePayment` gain `receivedAmount` | `paymentBreakdown`, `addPayment`, `updatePayment` and `removePayment` in `posStore.js` are **dead code for this flow**. `NewSale.jsx:26` destructures them and never calls them. Live payment state is `DiscountSummaryModal`'s local `splitBreakdown` plus `NewSale`'s `confirmedBreakdown`. | `posStore.js` is **not modified** (optionally: fix the stale comment at line 7). The real shape change is local modal state. See Decision 7. |

Line numbers that **did** hold: `validatePayments` at 34-57, the `"Cuenta Corriente"` normalization
block at 107-112, `validatePayments`/non-CC branch at 366-382, PASO 8 `orderPayment.create` at
422-431, the response at 570-586, `cajaServices` `getRegisterHistory:254` / `getGlobalHistory:285`
/ `getAllRegisters:327` / `closeRegister:100-215`, `SaleDetail.jsx:273-291`,
`RegisterHistory.jsx:173`.

---

## Architecture Decisions

### Decision 1: additive generated migration — the first one in this project that is NOT hand-written

Levels 1 and 2 both needed hand-written SQL because Prisma's PSL cannot express CHECK constraints
or partial unique indexes. **Nullable Decimal columns are fully inside the PSL surface**, so this
one is generated and the survival mechanics (schema comment + `pg_*` integrity test) do *not*
apply. Do not copy the `_stock_non_negative` template here — copying it would create a hand-written
file that `migrate dev` then duplicates.

```prisma
model OrderPayment {
  id             String   @id @default(cuid())
  orderId        String
  paymentMethod  String
  amount         Decimal  @db.Decimal(12, 2)   // NET: amount applied to the sale, never gross
  receivedAmount Decimal? @db.Decimal(12, 2)   // cash legs only; NULL otherwise and for pre-change rows
  changeAmount   Decimal? @db.Decimal(12, 2)   // round(receivedAmount - amount); NULL otherwise
  createdAt      DateTime @default(now())
  order          order    @relation(fields: [orderId], references: [id])
}
```

`npx prisma migrate dev --name order_payment_cash_change` →
`prisma/migrations/<ts>_order_payment_cash_change/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "OrderPayment" ADD COLUMN     "changeAmount" DECIMAL(12,2),
ADD COLUMN     "receivedAmount" DECIMAL(12,2);
```

**Nullable, no default, no backfill.** Pre-existing rows keep `NULL` and render exactly as today
(spec: "Pre-existing orders render unaffected"). `NOT NULL DEFAULT 0` was rejected: it would make
"this sale predates change tracking" indistinguishable from "this sale took exactly the right
money", which is precisely the audit distinction the columns exist to record.

### Decision 2: a case-insensitive predicate, and NO new method normalization

```js
// services/salesServices.js — single definition, three consumers
const isCashMethod = (method) => String(method ?? '').trim().toLowerCase() === 'efectivo';
```

The normalization block at `salesServices.js:107-112` maps `"Cuenta Corriente"` →
`"CUENTA_CORRIENTE"` and nothing else. **`"Efectivo"` is deliberately NOT added to it.**

| Option | Verdict |
|---|---|
| `if (p.method === "Efectivo") p.method = "EFECTIVO"` in the normalization block | **Rejected.** `paymentBreakdown[0].method` becomes `order.paymentMethod` for single-method sales (`salesServices.js:386`), and that string is rendered raw in the UI (`SaleDetail.jsx:286`, `SalesList`, `SalesHistory`). Normalizing would silently change every new ticket from "Efectivo" to "EFECTIVO", split the historical data into two spellings, and buy nothing — every reader already lowercases. |
| Strict `method === 'EFECTIVO'` | **Rejected** (proposal). The frontend sends `"Efectivo"` (`DiscountSummaryModal.jsx:12`); a strict check matches zero real sales and makes the mandatory rule a silent no-op. |
| A payment-method enum refactor | **Rejected** — own change, wider blast radius. |
| **Case-insensitive normalized compare** | **Chosen.** Byte-identical idiom to `cajaServices.js:175`, `cajaServices.js:365` and `CashRegister.jsx:150`. Four readers, one rule. |

`.trim()` is added over the existing idiom because `receivedAmount` is now *mandatory* on a match:
a stray space must not route a cash leg into the "ignore silently" branch.

### Decision 3: validation sequencing — shape before the tx, sufficiency after `validatePayments`

**Step A — shape/presence, pre-transaction.** New helper beside `validatePayments`, called
immediately after the normalization block (`salesServices.js:~113`), before the CC eligibility
reads and before `getCurrentRegister`:

```js
/**
 * Presencia y forma de `receivedAmount` en cada tramo en efectivo.
 * Corre ANTES de la transacción y ANTES de cualquier aritmética Decimal: un monto
 * malformado debe salir como 400 con `code`, nunca como un [DecimalError] desde
 * adentro de la tx. Mismo criterio que el guard de `frontendSubtotal`.
 * Los tramos NO-efectivo se ignoran en silencio (incluso si traen receivedAmount).
 */
function validateCashReceivedShape(paymentBreakdown) {
  for (const p of paymentBreakdown ?? []) {
    if (!isCashMethod(p.method)) continue;                 // non-cash: ignored, never an error
    if (!isPositiveAmount(p.receivedAmount)) {             // utils/money.js: finite && > 0
      throw Object.assign(
        new Error('Debe informar el monto recibido para cada pago en efectivo.'),
        { status: 400, code: 'CASH_RECEIVED_REQUIRED' }
      );
    }
  }
}
```

`isPositiveAmount` is reused verbatim from `utils/money.js` (Level 1) — it already returns `false`
for `undefined`, `null`, `NaN`, `Infinity`, `0`, negatives and non-numeric strings, inside a
`try/catch`, which is exactly the spec's rejection set. No new predicate.

**Step B — sufficiency + change math, inside the transaction, right after the
`validatePayments` / non-CC branch (`salesServices.js:366-382`):**

```js
// Tolerancia CERO, deliberadamente más estricta que validatePayments (Open Question #1):
// acá no hay cascada de redondeo de descuentos, solo un número tipeado por el cajero
// contra un `amount` de tramo ya validado.
const cashLegs = paymentBreakdown.filter(p => isCashMethod(p.method));
let totalChange = money(0);
for (const leg of cashLegs) {
  const legAmount = round(money(leg.amount));
  const received  = round(money(leg.receivedAmount));
  if (received.lt(legAmount)) {
    throw Object.assign(
      new Error(
        `El monto recibido en efectivo ($${toNumber(received)}) es menor al monto del pago ` +
        `($${toNumber(legAmount)}). Ingresá el efectivo que realmente recibiste.`
      ),
      { status: 400, code: 'CASH_RECEIVED_INSUFFICIENT' }
    );
  }
  leg._changeAmount = round(received.minus(legAmount));    // consumido por PASO 8 y la respuesta
  totalChange = totalChange.plus(leg._changeAmount);
}
```

**Why Step B is inside the transaction and not alongside Step A.** The comparison only means
something against a leg `amount` the backend trusts. Pre-transaction, `leg.amount` is an unverified
client number; it only becomes trustworthy after `validatePayments` (or the non-CC branch) proves
the legs sum to `computedFinalTotal`. Running the check earlier would compare two client-supplied
numbers to each other and still let a stale cart through. The cost — rolling back
`assertRegisterOpen`'s no-op write and any `discountRule.usedUnits` increment — is exactly one
aborted transaction, which `$transaction` already handles atomically. No `DecimalError` can escape
here because Step A has already proven both operands constructible.

Per-leg, not per-sale: two cash legs in one split each get their own check and their own change,
and `totalChange` is their sum (Open Question #2 locked per-leg granularity).

### Decision 4: persistence at PASO 8 and the response contract

`salesServices.js:422-431`, additive:

```js
for (const payment of paymentBreakdown) {
  const isCash = isCashMethod(payment.method);
  await tx.orderPayment.create({
    data: {
      orderId:        order.id,
      paymentMethod:  payment.method,
      amount:         payment.amount,                              // NET — unchanged
      receivedAmount: isCash ? round(money(payment.receivedAmount)) : null,
      changeAmount:   isCash ? payment._changeAmount : null,
    },
  });
}
```

Non-cash legs persist `NULL` for both columns even when the client sent a `receivedAmount` — the
spec's "ignored silently: not validated, not persisted, not an error".

The response (`salesServices.js:570-586`) currently returns `orderPayments: paymentBreakdown` —
the *request* array, not the DB rows. Two additions:

```js
return {
  ...order,
  orderPayments: paymentBreakdown.map(({ _changeAmount, ...p }) => ({
    ...p,
    ...(isCashMethod(p.method)
      ? { receivedAmount: round(money(p.receivedAmount)), changeAmount: _changeAmount }
      : {}),
  })),
  change: totalChange,          // total server-computed; el POS muestra ESTE número
  discountSummary: { /* unchanged */ },
  currentAccount: /* unchanged */,
};
```

**The response keys are named exactly like the DB columns on purpose.** `SaleDetail.jsx` renders
both the post-sale payload (`NewSale.jsx:350`, raw breakdown shape with `method`) and
DB-loaded orders (`paymentMethod` shape) through the same block, already tolerating
`p.paymentMethod || p.method` (`SaleDetail.jsx:279`). Matching `receivedAmount`/`changeAmount`
gives the ticket **one** rendering path instead of two. `Decimal` is returned end-to-end; the
global `res.json` serializer converts (Level 1). Tests calling `create()` directly must
`toNumber()` these, like every other money field.

### Decision 5: reporting — per-sale is free, only the shift aggregate is new code

| Function | Change | Why |
|---|---|---|
| `getGlobalHistory` (`:285`) | **None** | `include: { orderPayments: true }` (line 309) returns all columns; per-sale received/change arrive automatically. The shift total is explicitly out of scope (Open Question #5). |
| `salesServices.getAll` / `getById` | **None** | Same reason (`orderPayments: true`). |
| `getAllRegisters` (`:327`) | Additive `totals.vueltosEntregados` | `reg.orders` is **already** filtered `status: { not: 'CANCELLED' }` (line 347) — here the aggregate inherits the *right* default and needs no extra filter. State it in a comment so a future reader does not "fix" it. |
| `getRegisterHistory` (`:254`) | **Return shape change** to `{ items, totals }` | This query deliberately includes CANCELLED orders for audit (comment at line 268). The aggregate needs its own filter and must not be left to the client. |

`getAllRegisters`, inside the existing `registers.map`:

```js
// Las órdenes de `reg.orders` YA vienen filtradas `status: { not: 'CANCELLED' }`
// (include arriba). No agregar otro filtro acá, y no sacar el de arriba.
// Informativo: NO entra en ninguna fórmula de caja física.
const totalVueltos = sum(
  reg.orders.flatMap(o => o.orderPayments ?? []),
  p => p.changeAmount ?? 0
);
// → totals: { …, vueltosEntregados: totalVueltos }
```

`getRegisterHistory`, new envelope:

```js
// `orders` incluye CANCELLED a propósito (auditoría). El agregado de vueltos
// aplica su filtro PROPIO y explícito — heredar el default de esta query
// contaría el vuelto de una venta anulada contra el turno.
const vueltosEntregados = sum(
  orders.filter(o => o.status !== 'CANCELLED').flatMap(o => o.orderPayments ?? []),
  p => p.changeAmount ?? 0
);
return { items: unified, totals: { vueltosEntregados } };
```

| Option for the shift total | Verdict |
|---|---|
| Frontend derives it from the array | **Rejected.** `CashRegister.jsx` would own the cancelled-sale filter for a money figure, in a component whose existing `getOrderTotals` zeroes CANCELLED orders *by a separate code path* (`CashRegister.jsx:147`). Two filters, one drifting. This change exists to stop exactly that. |
| Attach a scalar property to the returned array | **Rejected** — `JSON.stringify` drops non-index properties on an array; it would arrive `undefined`. |
| New dedicated endpoint | **Rejected** — second round trip, no second consumer. |
| **`{ items, totals }` envelope** | **Chosen.** `getRegisterHistory` has exactly **one** consumer, `CashRegister.jsx:126-127`; the controller (`cajaController.js:39`) just `res.json`s the result and the Decimal serializer walks nested objects fine. Cost: two lines in the fetch plus one piece of state. |

`cajaController.exportRegisters` (`:89-115`) picks explicit keys, so `totals.vueltosEntregados` is
inert there. One additive column is in scope — and **must** use `toNumber()`, because Excel bypasses
the `res.json` serializer (Level 1 boundary rule, documented at `cajaController.js:91-96`):

```js
{ header: 'Vueltos Entregados ($)', key: 'vueltos', width: 20 },  // columns[]
vueltos: toNumber(t.vueltosEntregados),                           // data row
```

`fisicoExpected` (line 97) is **not** touched.

### Decision 6: `closeRegister` is unchanged, and that is a deliverable

`cajaServices.js:159-196` stays byte-identical: `openingAmount + Σ cash OrderPayment.amount +
Σ INCOME − Σ EXPENSE`. Because the cash leg is net, the surplus never entered the drawer total and
no offsetting term is needed. `tests/integrity/caja-expected-with-change.test.js` asserts the
resulting `difference === 0` on a shift of overpaid sales — the reported incident, reproduced as a
passing test. No `CashMovement` row is created by a sale, asserted by count in the same test.

### Decision 7: frontend — keep the engine payload free of `receivedAmount` by construction

`DiscountSummaryModal.jsx` is the payment entry point. Four precise facts about how it is actually
built drive the design:

1. **The single-mode leg amount is `finalTotal`, not `productsTotal`.** `activeBreakdown` (line
   62-64) uses `productsTotal` — gross — *only* to feed the discount preview without a circular
   reference. `handleConfirm` (line 166) submits `amount: finalTotal`. The received-amount gate and
   the exact-amount quick-fill MUST target **`finalTotal`**. Prefilling `productsTotal` on a
   discounted sale would hand the cashier a number larger than the sale and silently inflate the
   displayed change.
2. **`handleUpdatePayment` (line 139-141) destroys extra keys** — `{ method, amount }` replaces the
   whole entry. It must become `{ ...p, method, amount }` or every `receivedAmount` vanishes the
   moment the cashier edits a split amount.
3. **The debounced `onPaymentChange` effect (line 89-96) refires on `splitBreakdown` identity.**
   Putting `receivedAmount` in the entry would refire the discount preview on every keystroke.
   Fix structurally rather than by hope: send a projected engine breakdown and key the effect on
   its signature.

   ```js
   const engineBreakdown  = activeBreakdown.map(({ method, amount }) => ({ method, amount }));
   const engineSignature  = JSON.stringify(engineBreakdown);
   useEffect(() => { /* debounce 300ms */ onPaymentChange?.(engineBreakdown); },
             [engineSignature, isOpen]);
   ```

   This makes "payment-method discounts byte-identical before and after entering a received amount"
   a property of the code, not of a test: the preview is not even re-requested.
4. **`baseAmount` is added only in `handleConfirm` (line 156-166) and keeps deriving from net
   `amount`** — untouched.

State and interaction:

| Mode | State | Quick-fill | Gate |
|---|---|---|---|
| Single | `singleReceived` (string) | one tap → `finalTotal.toFixed(2)` | `isCashMethod(singleMethod)` ⇒ `parseFloat(singleReceived) >= finalTotal` |
| Split | `receivedAmount` on each `splitBreakdown` entry | per-leg tap → `p.amount.toFixed(2)` | every cash leg ⇒ `receivedAmount >= amount` |

Live change display per cash leg: `Math.max(0, received − amount)`, labeled **"Vuelto"**, display
only — the authoritative number is the server's `change`. The reset effect (line 76-85) clears
`singleReceived`. `handleConfirm` merges `receivedAmount` into the confirm breakdown (cash legs
only); confirm stays `disabled` while any cash leg is invalid, alongside the existing
`!isCovered` / `isProcessing` conditions.

The one-tap quick-fill is what makes "mandatory" survive contact with the counter (proposal's top
risk, Open Question #2 resolution). Without it, cashiers type garbage to get past the field.

Other frontend files:

| File | Change |
|---|---|
| `store/posStore.js` | **None** (dead for this flow — see Corrections). |
| `pages/sales/NewSale.jsx` | **Near-none.** `processSale` forwards `finalBreakdown` verbatim (line 331) so `receivedAmount` rides along with zero code change, and `setCurrentSale({ ...response.data, items: cart })` (line 350) already carries `change` + enriched `orderPayments` into `SaleDetail`. The `catch` leaves `CASH_RECEIVED_*` on the existing `alert(message)` path — these 400s are only reachable from a stale tab that bypassed the UI gate, and the message is self-explanatory; adding them to `CASH_REGISTER_RECOVERY_CODES` would offer an "Abrir caja" button for an unrelated failure. |
| `pages/sales/SaleDetail.jsx` (273-291) | Received/change lines in **both** branches — the multi-leg `.map` (276-281) *and* the single-leg fallback (283-290), which is the common exact-cash path and does not iterate `orderPayments` today. Render the change line only when `changeAmount > 0` (spec: no change line at zero). |
| `pages/sales/CashRegister.jsx` | `setHistory(histRes.data.items ?? [])` + new `shiftTotals` state (line 126-127); "Vueltos entregados" as a labeled informational row; per-order change in the history rows (line 599 map). `getOrderTotals` (144-165) reads only `p.amount` and must stay that way; the `fisico` loops at 226-234 and ~794 are **untouched**. |
| `pages/Reportes/RegisterHistory.jsx` | "Vueltos entregados" row from `t.vueltosEntregados`; `fisicoExpected` (line 173) **untouched**. |

### Decision 8: tests — house style, two new scripts

Plain `node`, local `assert()`, `module.exports = main` for async scripts, registered in
`tests/run-all.js` (lines 18-35). No framework (Level 1 decision, unchanged;
`strict_tdd: false` for this project).

| File | Status | Covers (Success Criteria) |
|---|---|---|
| `tests/scenarios/cash-change.test.js` | New | 1) cash leg without `receivedAmount` → `status 400`, `code CASH_RECEIVED_REQUIRED`, **zero** `order` rows created (proves it fired pre-tx); same for `0`, negative, `NaN`, non-numeric. 2) `amount 100 / received 99.99` → 400 `CASH_RECEIVED_INSUFFICIENT`, message contains both figures. 3) exact: `received === amount` → accepted, `changeAmount === 0`. 4) overpayment `100/150` → `amount 100`, `receivedAmount 150`, `changeAmount 50`, `Σ orderPayments.amount === order.amount`. 5) response carries `change === 50`. 6) split cash+tarjeta and split cash+CUENTA_CORRIENTE: change computed on the cash leg only; card leg and CC debt untouched (`currentAccount.balance` unchanged by the surplus). 7) `receivedAmount` on a Tarjeta leg → accepted, both columns `NULL`. 8) literal `"Efectivo"` — the exact string `DiscountSummaryModal.jsx:12` sends — is detected as cash (this is the test that stops the mandatory rule becoming a no-op). 9) discount parity: same cart/rules run with and without `receivedAmount` → identical `discountTotal` and `appliedDiscounts`. |
| `tests/integrity/caja-expected-with-change.test.js` | New | The drawer invariant and the non-change. A shift of N overpaid cash sales, every change handed back: `expectedAmount === openingAmount + Σ net cash` and `difference === 0` when `closingAmount` equals the physical cash. Plus: **zero** `cashMovement` rows created by the sales, and `getRegisterHistory().totals.vueltosEntregados` / `getAllRegisters()[0].totals.vueltosEntregados` equal `Σ changeAmount` **excluding** a cancelled overpaid sale created in the same shift. |
| `tests/run-all.js` | Modified | Register both, after `./integrity/caja-open-index.test.js`. |

**Regression re-runs, mandatory before merge** — every fixture that creates a cash sale now has to
supply `receivedAmount` or the suite fails with `CASH_RECEIVED_REQUIRED`. This is the single most
likely way to break something while fixing something else:
`tests/scenarios/{cc-exact-payment,cancel-reverses-debt,movement-validation}.test.js`,
`tests/concurrency/{sale-race,sale-vs-caja-close-race,caja-close-race}.test.js`.
`movement-validation.test.js:143-155` additionally asserts exact `expectedAmount` / `difference`
values — it must still pass **unmodified in its assertions**, which is the sharpest proof that
`closeRegister` is untouched.

Fixture hygiene, house style: self-contained `setupFixtures` / `cleanup`, unique `__*_test_store__`
names, `process.exitCode` on assert failure.

---

## Data Flow

```
POST /api/sales  { paymentBreakdown: [{ method:"Efectivo", amount: 100, receivedAmount: 150 }, …] }
      │
      ├─ normalize "Cuenta Corriente" -> CUENTA_CORRIENTE        (:107-112, "Efectivo" NOT touched)
      ├─ validateCashReceivedShape()                             PRE-TX, no Decimal
      │     isPositiveAmount(receivedAmount) === false ──> 400 { CASH_RECEIVED_REQUIRED }
      │
      └─ $transaction
            ├─ PASO 1  read products        ├─ PASO 1.5 assertRegisterOpen
            ├─ PASO 3-5 discount engine ──> computedFinalTotal   (baseAmount <- NET amount)
            ├─ validatePayments / non-CC branch                  (:366-382)
            ├─ per cash leg:  received < amount ──> 400 { CASH_RECEIVED_INSUFFICIENT }  (tolerance 0)
            │                 _changeAmount = round(received - amount)
            ├─ PASO 7  order.create
            ├─ PASO 8  orderPayment.create { amount: NET, receivedAmount, changeAmount }
            └─ response { …order, orderPayments:[…+received/change], change: Σ }
                     │
             res.json ──> decimalSerializer (Decimal -> Number) ──> POS shows SERVER's `change`

  closeRegister:  opening + Σ cash OrderPayment.amount + Σ INCOME − Σ EXPENSE   ◄── UNCHANGED
                                      ▲ NET, so the surplus was never in here
                                        and no CashMovement offsets it

  getRegisterHistory ──> { items, totals:{ vueltosEntregados } }   filter status !== CANCELLED (explicit)
  getAllRegisters    ──> totals.vueltosEntregados                  filter inherited (include already excludes)
                              │
                              └──> labeled, informational — NOT a term in fisico / fisicoExpected
```

---

## File Changes

### Backend (`stock-controll-back`)

| File | Action | Description |
|---|---|---|
| `prisma/schema.prisma` | Modify | `OrderPayment.receivedAmount` / `changeAmount`, `Decimal? @db.Decimal(12,2)` |
| `prisma/migrations/<ts>_order_payment_cash_change/migration.sql` | Create | Generated (`migrate dev`), additive, nullable |
| `services/salesServices.js` | Modify | `isCashMethod`; `validateCashReceivedShape` pre-tx; sufficiency + change math after `validatePayments`; PASO 8 persistence; `change` + enriched `orderPayments` in the response |
| `services/cajaServices.js` | Modify | `getRegisterHistory` → `{ items, totals }` with explicit non-cancelled filter; `getAllRegisters` → `totals.vueltosEntregados` |
| `services/cajaServices.js` (`closeRegister`) | **Unchanged (asserted)** | Formula byte-identical; proven by test, not assumed |
| `controllers/cajaController.js` | Modify | One additive Excel column, via `toNumber()` |
| `tests/scenarios/cash-change.test.js` | Create | — |
| `tests/integrity/caja-expected-with-change.test.js` | Create | — |
| `tests/run-all.js` | Modify | Register both |
| `tests/scenarios/*`, `tests/concurrency/*` (6 scripts) | Modify | Fixtures supply `receivedAmount` on cash legs; assertions unchanged |

### Frontend (`stock-controll-main`)

| File | Action | Description |
|---|---|---|
| `src/components/Modals/DiscountSummaryModal.jsx` | Modify | "Monto recibido" per cash leg (single + split), exact-amount quick-fill against `finalTotal` / `p.amount`, live "Vuelto", confirm gate; spread-preserving `handleUpdatePayment`; signature-keyed preview effect |
| `src/pages/sales/SaleDetail.jsx` | Modify | Received/change in both breakdown branches; change line only when `> 0` |
| `src/pages/sales/CashRegister.jsx` | Modify | `.items` + `shiftTotals`; "Vueltos entregados" row; per-order change; `fisico` untouched |
| `src/pages/Reportes/RegisterHistory.jsx` | Modify | "Vueltos entregados" row; `fisicoExpected` untouched |
| `src/pages/sales/NewSale.jsx` | Modify (minimal) | No forwarding change needed; optional comment noting `change` arrives from the server |
| `src/store/posStore.js` | **Not modified** | Dead code for this flow |

---

## What we are NOT doing, and why

| Not doing | Why |
|---|---|
| **Gross cash leg + a change `CashMovement(EXPENSE)`** | Nets correctly for the close but breaks three other things: it skews `handleConfirm`'s proportional `baseAmount` split (`DiscountSummaryModal.jsx:156-166`), which the backend evaluator uses for payment-method discounts → wrong discounts; it turns `getAllRegisters.ventasEfectivo` (`cajaServices.js:366`) into gross cash, breaking revenue-by-method; and it makes `Σ breakdown > order.amount` structurally normal, permanently disarming the only guard (`validatePayments`) that would catch a real manipulation. |
| **A `MovementType.CHANGE_GIVEN` enum value** | The drawer never kept the change, so expected cash is already right — a movement that must be *excluded* from the `EXPENSE` sum to avoid double-subtraction is a lie in the ledger. It also forces a Postgres `ALTER TYPE`, a change to `closeRegister`'s expense filter, to `getAllRegisters`' buckets, and to 5+ binary `type === 'INCOME' ? … : …` frontend branches (`CashRegister.jsx:231,601,635,801`, `RegisterHistory.jsx:371`, `SalesHistory.jsx`, `SalesList.jsx`). Miss one and close arithmetic silently breaks — the exact bug class this change exists to kill. |
| **An order-level single `change` column** | Breaks the moment a split sale has two cash legs, and cannot say *which* leg the change came from. |
| **`reference` free-text magic string / a new table** | Unparseable and unqueryable / no second consumer. |
| **Reusing `CashMovement(EXPENSE)` with a discriminator for the arqueo line** | It would land in `retirosManuales` and render as "EGRESO / Retiro Manual" everywhere, mislabeling change as a withdrawal. |
| **Touching `validatePayments`' general tolerance** | Out of scope in both prior levels, out here too. The `receivedAmount` check carries its own zero tolerance and shares no code path. (Note: the claimed `$0.50` cap is **not** on this branch — see Corrections.) |
| **Backfilling historical orders** | Columns are nullable; pre-change rows render as today. The reported incident's inflated close is a historical record; correcting it is a manual accounting decision, not a code path. |
| **`receivedAmount` on `currentAccountServices.registerPayment`** | Explicit product-owner scope decision — Nueva Venta only this slice. |
| **Shift "vueltos" total in `getGlobalHistory`** | Open Question #5: shift/arqueo only. Per-sale received/change still arrive there for free. |
| **Hand-writing the migration** | Unlike Levels 1 and 2, nullable Decimal columns are inside Prisma's PSL surface. Hand-writing would create a file `migrate dev` then duplicates. |

---

## Migration / Rollout

Additive and nullable, so the migration is safe to apply over existing data with no pre-flight
query (contrast with Level 2's `CREATE UNIQUE INDEX`, which could fail on dirty data).

Order: `prisma migrate dev` local → update the 6 regression fixtures → full `node tests/run-all.js`
→ apply on Supabase over the **direct** connection (port 5432, never the 6543 pooler — DDL breaks
on the pooler, per Level 1) → deploy backend → deploy frontend.

**Backend and frontend ship as a matched pair, backend first, with a known gap window**: between
the two deploys, a cash sale from an old tab is rejected `400 CASH_RECEIVED_REQUIRED` with a clear
message. That is a visible, recoverable failure and is the intended behavior — never a silent
inflated drawer. Keep the window short.

---

## Rollback

Three units, with one hard ordering rule.

1. **Frontend first.** Reverting the backend while a strict frontend is live is harmless; reverting
   the frontend while a strict backend is live is not — every cash sale would be rejected. So:
   **revert the frontend before, or in the same deploy as, the backend.**
2. **Backend code** reverts per file. `salesServices.js` and `cajaServices.js` are independent:
   reverting only the reporting half leaves the validation half working, and vice versa. The one
   coupling is `getRegisterHistory`'s envelope — revert it together with `CashRegister.jsx:126-127`
   or the shift view renders empty.
3. **The migration can be left in place.** Nullable columns with no default and no reader after a
   code revert have zero behavioral effect. Dropping them needs its own migration
   (`ALTER TABLE "OrderPayment" DROP COLUMN …`) and is optional; a full `migrate reset` also wipes
   data and requires `node prisma/seedRbac.js` before `npx prisma db seed` (Level 1 seed gotcha).

Both new test files delete with their `tests/run-all.js` entries. The 6 modified regression
fixtures revert with the backend.

---

## Open Questions

- [x] **Where does the shape validator live, given `validatePaymentBreakdownAmounts` does not
  exist?** Resolved in Decision 2/3: a local `validateCashReceivedShape` in `salesServices.js`,
  beside `validatePayments`. The proposal's placement (`discountEngine/universal.js`) is not just
  a wrong path — a cash-received concern does not belong in the discount engine, which is a pure
  function of items, rules and method *names*. The proposal's *intent* (pre-transaction, before
  Decimal arithmetic, house `{ status, code }` contract) is honored exactly.

- [ ] **`getRegisterHistory`'s return shape change is a real, if small, contract break.** It has
  exactly one consumer today (`CashRegister.jsx:126`), verified by grep across both repos, so the
  cost is two lines. Flagged rather than silently absorbed because any external script or future
  consumer calling `GET /api/caja/history` and expecting a bare array will break. Alternatives and
  their rejections are in Decision 5; needs a product-owner nod before `sdd-tasks`, or an explicit
  "accept the break".

- [ ] **Six existing test fixtures must be edited to add `receivedAmount`.** The proposal prices
  two new test files and does not mention the regression fixtures. This is mechanical, not
  risky, but it is real scope (~6 files) and it is the most likely source of a red suite during
  apply. Recorded, not absorbed.

- [ ] **The uncapped `validatePayments` tolerance is still live on this branch** (`:46`, `:374`,
  `:222`). This change does not depend on the claimed `$0.50` cap and does not touch it. If the
  sibling PR is still unmerged at apply time, nothing here changes — but the proposal's Risks table
  states that risk as "closed", and it is not. Flagged for the record.
