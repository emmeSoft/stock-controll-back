# Universal Discount Calculation Specification

## Purpose
Define the logic for evaluating and applying discount rules to a sale, ensuring deterministic results and preventing over-discounting through a layered approach.

## Requirements

### Requirement: Layered Evaluation (ITEM -> ORDER)
The system MUST evaluate discounts in two distinct layers:
1. **ITEM_LEVEL**: Rules targeting specific products or categories.
2. **ORDER_LEVEL**: Rules targeting the entire transaction subtotal.

#### Scenario: Sequential Application
- GIVEN a cart with a product $1000
- AND an ITEM_LEVEL rule of 10%
- AND an ORDER_LEVEL rule of 5%
- WHEN calculating total
- THEN the product is first discounted to $900
- AND then the 5% is applied to the $900 residual
- AND the final price is $855

### Requirement: Competitive Item Rules (1 Winner per Item)
The system SHALL NOT apply more than one ITEM_LEVEL rule to the same product instance. If multiple rules apply, the one with the highest monetary impact MUST be selected.

#### Scenario: Maximum Impact Selection
- GIVEN a product $1000
- AND Rule A (20% off, maxUnits: 1)
- AND Rule B (10% off, No limit)
- WHEN carrying 1 unit
- THEN Rule A is selected (Impact: $200)
- AND the final price is $800

### Requirement: Max Units Strategy (Maximize Discount)
When a rule has a `maxUnits` constraint, the system MUST apply the discount to the units with the highest unit price first.

#### Scenario: High-Price First
- GIVEN a rule "10% off category Laptops, maxUnits: 1"
- AND the cart has Laptop A ($1500) and Laptop B ($1000)
- WHEN calculating discount
- THEN the 10% is applied to Laptop A ($150)
- AND Laptop B remains at $1000
- AND the total discount is $150

### Requirement: Global Ticket Guards
The system MUST NOT apply any discount if the transaction does not meet the rule's `ticketConditions`.

#### Scenario: Cash Only Restriction
- GIVEN a rule with `ticketConditions.paymentMethods = ["EFECTIVO"]`
- WHEN the user pays with "CREDITO"
- THEN the discount is NOT applied.
