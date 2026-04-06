# Universal Discount Management Specification

## Purpose
Define how discount rules are created, configured, and stored using a composable rule-builder approach.

## Requirements

### Requirement: Composable Conditions
The system MUST support an "AND" logical combination of conditions within a single rule. A rule is only applicable if ALL configured conditions are met.

#### Scenario: Combined Product and Payment Method
- GIVEN a rule targeting "Product A"
- AND requiring "Payment Method: CASH"
- WHEN a sale has "Product A" but "Payment Method: CREDIT"
- THEN the rule is deemed NOT applicable.

### Requirement: Layer Inference
The system SHALL automatically determine if a rule is `ITEM_LEVEL` or `ORDER_LEVEL` based on the presence of a `target` (productIds or categoryIds).

#### Scenario: Target exists -> ITEM_LEVEL
- GIVEN a rule with `target.productIds = ["P1"]`
- WHEN saving the rule
- THEN the system stores it as an `ITEM_LEVEL` rule.

#### Scenario: Empty target -> ORDER_LEVEL
- GIVEN a rule with `target = null`
- WHEN saving the rule
- THEN the system stores it as an `ORDER_LEVEL` rule.

### Requirement: Unit Limit Guard
Any rule MAY include a `maxUnits` constraint. If present, the system MUST prevent discounting more units than the defined limit across all items in the sale.

#### Scenario: Global Item Limit
- GIVEN a rule "10% off category Drinks, maxUnits: 2"
- AND the cart has 3 Drinks
- WHEN evaluating
- THEN only 2 drinks receive the discount.
