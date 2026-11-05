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

## Archive Summary

This design was successfully implemented across two repositories (stock-controll-back + stock-controll-main) as a Level 3 SDD change (cash-change-calculation). All success criteria were met and verified through comprehensive testing. The change maintains backward compatibility with nullable columns and introduces no breaking behavior changes for pre-existing orders.

Key deliverables:
- Backend: Schema migration, validation, persistence, and reporting layers
- Frontend: Payment input modal, ticket display, shift arqueo display
- Tests: 24 registered tests (22 pre-existing + 2 new), all passing
- Cross-repo verification: Both repositories' PRs merged to main (4 backend, 2 frontend)

See verify-report.md for full test execution evidence and cross-repo field-name verification.
