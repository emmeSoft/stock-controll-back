# Design: Universal Discount Rules

## Technical Approach
The implementation transitions from a Strategy Pattern (multiple evaluators) to a **Sequential Pipeline** (UniversalEvaluator). This pipeline processes the cart in two passes: `ITEM_LEVEL` (where rules compete for the best monetary impact per SKU) and `ORDER_LEVEL` (where the best global rule applies to the residual subtotal).

## Architecture Decisions

### Decision: Monetary Impact Selection
**Choice**: Selecting the rule that yields the highest absolute discount amount.
**Alternatives considered**: Manual priority field, "First Match" system.
**Rationale**: Automated impact projection is fairer for the customer and eliminates the need for complex manual priority ordering by the business owner.

### Decision: Layers by Inference
**Choice**: Inferring `ITEM_LEVEL` or `ORDER_LEVEL` from the `target` field.
**Alternatives considered**: Explicit `layer` field in DB.
**Rationale**: Reduces data redundancy and the risk of a "Global" rule having a specific product ID attached (invalid state).

## Data Flow
```
Cart (Frontend) ──→ API (Preview/Sale) ──→ UniversalEvaluator
                                            │
    1. Filter Vigency & Global Guards ──────┘
    2. Split Layers (Target vs No Target)
    3. ITEM Layer: Best Impact per Sku (MAXIMIZE_DISCOUNT)
    4. ORDER Layer: Best Impact on Residual
    5. Final Guard (Min Price $0.01)
```

## File Changes
| File | Action | Description |
|------|--------|-------------|
| `services/discountEngine/index.js` | Modify | Entry point for Universal Pipeline. |
| `services/discountEngine/evaluator.js` | Create | The core logic for filtering and layer execution. |
| `services/discountEngine/calculator.js` | Create | Money math: impact simulation and final application. |
| `services/discountEngine/evaluators/*.js` | Delete | Siloed evaluators no longer needed. |
| `components/Discounts/DiscountFormModal.jsx` | Modify | UI change to Toggle-based rule builder. |
| `prisma/seed.js` | Modify | Update seed to the new Universal format. |

## Interfaces / Contracts

### Universal Rule Conditions (JSON)
```javascript
{
  target: { productIds: string[], categoryIds: string[] } | null,
  ticketConditions: { paymentMethods: string[], minAmount: number, allClients: boolean, clientIds: string[] },
  itemConditions: { minQuantity: number },
  constraints: { maxUnits: number }
}
```

### CartItem (Internal)
```javascript
{
  productId: string,
  unitPrice: number,
  quantity: number,
  originalSubtotal: number,
  residualSubtotal: number, // used for ORDER level calculation
  appliedItemRule: { ruleId: string, amount: number } | null
}
```

## Testing Strategy
| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | `simulateMonetaryImpact` | Manual test scripts with edge cases (prices, quantities). |
| Integration | `UniversalEvaluator` | Pipeline tests with 1 ITEM + 1 ORDER rule. |
| Manual | UI Modal | Verify toggles produce correct JSON payload. |

## Migration / Rollout
**Phased cleanup**:
1. Implement `UniversalEvaluator` alongside the existing one (internal testing).
2. Run `migrate.js` to convert existing rules to the new JSON schema.
3. Switch endpoints to use the new engine.
4. Delete old evaluator files.

## Open Questions
- [ ] Should we support "Excluded Products" in global rules? (Deferred to v2.1).
- [ ] How to handle "Buy 3, Pay 2"? (Handled via `minQuantity` and `percentage` (33.33%) for now).
