# Spec: POS Submit Safety

## Overview

This spec ensures that every money-bearing POS submit handler guards against duplicate submissions via repeated clicks or double-submit actions, preventing the same operation from being sent multiple times while a request is in flight.

## Requirements

### Requirement: Single-Flight Money-Bearing Submit Handlers

Every POS submit handler that triggers a money-bearing backend request — `CashRegister.jsx`'s `executeOpen`, `executeClose`, and `executeMovement`, and `RegisterPaymentModal.jsx`'s submit (via `CurrentAccountDetails.jsx`'s `handleRegisterPayment`) — MUST guard against duplicate submission while a request is in flight, using the same `isProcessing`-state pattern already implemented in `NewSale.jsx` (`isProcessing` guard + early return + disabled trigger control + reset in `finally`). A repeated click or submit while the prior request is pending MUST NOT produce a second network request.

#### Scenario: Double-click "Abrir Caja"

- GIVEN the "Abrir Caja" button is clicked while no request is in flight
- WHEN the button is clicked a second time before the first request resolves
- THEN exactly ONE `openRegister` request MUST be sent
- AND the button MUST be visibly disabled while the request is in flight

#### Scenario: Double-click "Forzar Cierre"

- GIVEN the "Forzar Cierre" (close) button is clicked while no request is in flight
- WHEN the button is clicked a second time before the first request resolves
- THEN exactly ONE `closeRegister` request MUST be sent
- AND the button MUST be visibly disabled while the request is in flight

#### Scenario: Double-click the movement ConfirmModal

- GIVEN a cash movement `ConfirmModal` is confirmed
- WHEN the confirm action is triggered a second time before the first request resolves
- THEN exactly ONE `createMovement` request MUST be sent
- AND the `ConfirmModal` MUST close before the request is awaited, not remain clickable for the request's duration

#### Scenario: Double-click `RegisterPaymentModal`'s submit

- GIVEN `RegisterPaymentModal`'s submit button is clicked while no request is in flight
- WHEN the submit is triggered a second time before the first request resolves
- THEN exactly ONE `registerPayment` request MUST be sent
- AND the submit control MUST be visibly disabled while the request is in flight
