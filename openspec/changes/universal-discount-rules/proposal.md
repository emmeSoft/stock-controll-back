# Proposal: Universal Discount Rules

## Intent
Migrate from 8 rigid discount types to a single Universal Rule based on composable fields (target, global conditions, line conditions, and limits) to eliminate code duplication and enable combinable business constraints (e.g., specific product + cash payment) without breaking constraints.

## Scope
### In Scope
- Refactoring `DiscountRule` usage to a single universal pipeline.
- Creating the UniversalEvaluator enforcing ITEM_LEVEL and ORDER_LEVEL strict segregation.
- Enforcing MAXIMIZE_DISCOUNT strategy for `maxUnits`.
- Upgrading `DiscountFormModal.jsx` to a toggle-based Rule Builder.
- Seed/migration script for existing rules.

### Out of Scope
- Modifying UI components outside of `DiscountsMainPage` and `DiscountFormModal`.
- Altering the POS flow other than preview payload validation.

## Capabilities
### Modified Capabilities
- **discount-management**: Changing rule structures from siloed enum to composable rules.
- **discount-calculation**: Pipeline logic moves from single-strategy pattern to sequential universal evaluation.

## Approach
Implement a deterministic pipeline: target/ticket filtering -> split by layers -> calculate max impact per product (1 item rule max) -> calculate max impact for residual subtotal (1 order rule max). Evaluate max units using descending unit price sorting.

## Affected Areas
| Area | Impact | Description |
|------|--------|-------------|
| `services/discountEngine/*` | Modified | Total refactor to Universal Evaluator |
| `controllers/discountController.js` | Modified | Payload validation upgrades |
| `DiscountFormModal.jsx` | Modified | Toggle UI and JSON builder |
| `prisma/seed.js` | Modified | Existing rules migration logic |

## Risks
| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Price drop below 0 | Low | Hard guard `Math.max(x, 0.01)` in calculation core |
| Concurrency on maxUnits | Med | Optimistic locking on `usedUnits` inside transaction |

## Rollback Plan
Since it's in development, rollback involves reverting git commits for the engine and restoring the pre-migration DB dump.

## Success Criteria
- [ ] No more than 1 ITEM_LEVEL and 1 ORDER_LEVEL rule applied per product.
- [ ] Preview accurately computes combined discounts (Item + Cash).
- [ ] Modal correctly sets null target for global rules.
