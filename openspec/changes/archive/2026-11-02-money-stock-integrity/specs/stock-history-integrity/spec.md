# Delta for Stock History Integrity

## MODIFIED Requirements

### Requirement: Stock Movement Recording

The system MUST record an entry in the stock history (`StockHistory`) every time a product's stock changes. Every mutation that changes stock (sale, cancellation, manual adjustment, initial load) MUST be performed via an atomic, DB-level conditional operation (`updateMany` with a `WHERE` guard, or atomic `increment`/`decrement`), and the `StockHistory` previous/current values MUST derive from the post-write database state, never from a pre-read value.
(Previously: stock mutations used an absolute `SET` based on a prior read, with no atomicity or post-write-derivation guarantee.)

#### Scenario: Successful initial load recording

- GIVEN a new product being created with a stock of 20 units
- WHEN the product is successfully saved to the database
- THEN the system MUST create a `StockHistory` record with type `INITIAL`
- AND the `movementAmount` MUST be 20
- AND the `currentStock` MUST be 20

#### Scenario: Successful manual adjustment recording

- GIVEN an existing product with a stock of 50 units
- WHEN the user adjusts the stock to 40 units manually
- THEN the system MUST create a `StockHistory` record with type `MANUAL_ADJUSTMENT`
- AND the `movementAmount` MUST be -10
- AND the `currentStock` MUST be 40

#### Scenario: Concurrent sales of the last unit

- GIVEN a product with stock of 1 unit
- WHEN two sale requests for 1 unit each are submitted concurrently
- THEN exactly one request MUST succeed with 201 and decrement stock to 0
- AND the other MUST be rejected with 409
- AND exactly one `StockHistory` row MUST be created for the decrement

#### Scenario: Concurrent manual edit does not erase a concurrent sale

- GIVEN a product with stock of 10 units
- WHEN a manual stock edit and a sale decrement are submitted concurrently
- THEN both mutations MUST apply as relative increment/decrement operations
- AND the final stock MUST reflect both changes
- AND neither mutation MUST silently overwrite the other's effect

## ADDED Requirements

### Requirement: Non-Negative Stock Constraint

The system MUST enforce a database-level `CHECK (stock >= 0)` constraint on `product.stock` as a second safety net behind the application-level atomic guards.

#### Scenario: Direct SQL update rejected

- GIVEN a product with stock of 0 units
- WHEN a direct SQL statement `UPDATE product SET stock = -1` is executed
- THEN the database MUST reject the statement due to the CHECK constraint
