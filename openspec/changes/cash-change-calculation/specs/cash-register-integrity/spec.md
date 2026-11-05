# Delta for Cash Register Integrity

## MODIFIED Requirements

### Requirement: Register-Bound Operation Consistency

The system MUST validate, atomically within the same `$transaction` as the money/stock-affecting write, that the target cash register is still `status: 'OPEN'`, for every operation that binds to a register: `salesServices.create` (at the stock-decrement write), `movimientosServices.createMovement`, and `currentAccountServices.registerPayment` (cash payments). An operation racing a close MUST either land before the close completes (counted in the close's `expectedAmount`) or be rejected with `status === 409` (excluded from `expectedAmount`) — it MUST NOT both take effect (customer charged, movement recorded, payment recorded) and be excluded from the close's totals. A drawer stays balanced when a cash payment exceeds the sale total, because a cash `OrderPayment.amount` is the net amount applied to the sale and MUST NEVER carry a received-amount surplus; an overpaid cash sale contributes exactly its net amount to `expectedAmount`, never the gross amount handed over.
(Previously: silent on what a cash `OrderPayment.amount` represents when the customer hands over more than the sale total — no stated invariant protecting `expectedAmount` from an overpayment surplus.)

#### Scenario: Sale committed in the close window

- GIVEN a register being closed concurrently with an in-flight sale submission
- WHEN both operations race
- THEN the sale MUST either complete and be counted in `expectedAmount`, or be rejected with `status === 409`
- AND no `order` row MUST exist whose `cashRegisterId` points to a register with `closedAt` earlier than the order's `createdAt`

#### Scenario: Manual movement or cash CC payment committed in the close window

- GIVEN a register being closed concurrently with an in-flight `createMovement` or cash `registerPayment` request
- WHEN both operations race
- THEN the movement/payment MUST either complete and be counted in `expectedAmount`, or be rejected with `status === 409`
- AND it MUST NOT be recorded while excluded from the close's totals

#### Scenario: Balanced drawer under concurrent sale traffic

- GIVEN a drawer whose physical cash matches all sales completed before its close
- WHEN the close executes while sale traffic is concurrently hitting the register
- THEN the reported `difference` MUST equal `0`

#### Scenario: Balanced drawer with an overpaid cash sale and change given back

- GIVEN a shift containing a cash sale where `receivedAmount` exceeded that leg's `amount` and the change was handed back to the customer
- WHEN the register is closed for that shift
- THEN the reported `difference` MUST equal `0`
- AND `expectedAmount` MUST equal opening amount plus net cash sales for the shift
- AND no `CashMovement` row MUST exist representing the change

#### Scenario: Close computation formula is byte-identical to pre-change behavior

- GIVEN the `closeRegister` implementation after this change
- WHEN `expectedAmount` is computed for any register
- THEN the formula MUST remain `openingAmount + Σ cash OrderPayment.amount + Σ INCOME − Σ EXPENSE`
- AND no new term MUST be added for `receivedAmount`, `changeAmount`, or any change-related movement
