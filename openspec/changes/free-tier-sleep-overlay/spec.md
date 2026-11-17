# Spec: Free Tier Sleep Overlay

**Change**: free-tier-sleep-overlay
**Capabilities**: `store-tier-configuration` (new), `free-tier-sleep-overlay` (new)
**Status**: Draft

## Overview

Render's free plan sleeps the backend after 15 minutes idle (~50s cold start). This spec defines `isFreeTier` as a per-store subscription-tier signal (decoupled from real infra state) and a global overlay that explains the resulting delay to non-SISTEMA users on free-tier stores, while SISTEMA never sees it.

## Requirements

### Requirement: SISTEMA-Only Tier Flag

The system MUST expose `store.isFreeTier` as a Boolean, server-side-gated field. Only the SISTEMA role MUST be able to read or write it; the frontend field/column visibility is cosmetic only — the authoritative gate is the server `allowedFields` whitelist (same pattern as `maxDiscountPct`).

#### Scenario: Non-SISTEMA write attempt is dropped server-side

- GIVEN a non-SISTEMA user sends a store update request containing `isFreeTier`
- WHEN the request reaches `storesServices.js`
- THEN the server MUST silently drop `isFreeTier` from the allowed update fields
- AND MUST NOT change the stored value

#### Scenario: New store defaults to free tier

- GIVEN a new store is created
- WHEN the record is persisted
- THEN `isFreeTier` MUST default to `true`

#### Scenario: Existing stores are backfilled to free tier

- GIVEN the migration adding `isFreeTier` runs against existing data
- WHEN the migration completes
- THEN every pre-existing store MUST have `isFreeTier = true`

#### Scenario: SISTEMA toggle takes effect immediately

- GIVEN a store has `isFreeTier = true`
- WHEN SISTEMA sets it to `false`
- THEN both overlay states MUST stop appearing for that store on the next request, with no further migration needed

### Requirement: Idempotent Wake Endpoint

The system MUST provide an idempotent `GET /api/health` endpoint with no side effects, used exclusively to "wake" a sleeping backend instance.

#### Scenario: Health endpoint never mutates state

- GIVEN the backend is asleep or awake
- WHEN `GET /api/health` is called any number of times
- THEN the response MUST NOT alter any persisted data
- AND the overlay's "Despertar" button MUST call only this endpoint, never a mutating route

### Requirement: Overlay — Asleep State

For a non-SISTEMA user on an `isFreeTier=true` store, the system MUST show the `asleep` overlay state when idle time has reached the threshold and no wake request is already in flight.

#### Scenario: Idle threshold reached while tab is backgrounded then refocused

- GIVEN `now - lastRequestAt >= 15min`
- AND no wake request is currently in flight
- WHEN the user triggers a `visibilitychange` or `focus` event (e.g. returns to the tab)
- THEN the system MUST display the `asleep` overlay with informational Spanish copy and a "Despertar" button
- AND the button, when clicked, MUST call `GET /api/health` and transition to `despertando`

#### Scenario: Idle threshold not yet reached

- GIVEN `now - lastRequestAt < 15min`
- WHEN a `visibilitychange` or `focus` event fires
- THEN the system MUST NOT show the `asleep` overlay

### Requirement: Overlay — Despertando State

For a non-SISTEMA user on an `isFreeTier=true` store, the system MUST show the `despertando` overlay state while a wake request (health-check click or login submit) is in flight, with no button, and MUST enforce a 30-second minimum display measured from when the wake-trigger started.

#### Scenario: Wake triggered by "Despertar" click

- GIVEN the `asleep` overlay is visible
- WHEN the user clicks "Despertar"
- THEN the system MUST switch to `despertando` with no button
- AND MUST keep it visible for at least 30 seconds from the click, even if `GET /api/health` resolves sooner
- AND MUST auto-dismiss once both the request has resolved AND the 30s floor has elapsed

#### Scenario: Wake triggered by login submit

- GIVEN a free-tier, non-SISTEMA user submits the login form
- WHEN the login POST is sent
- THEN the system MUST treat the submit itself as the wake trigger and start the 30s floor from that moment, not from the response

### Requirement: Wake Request Failure Handling

If the `GET /api/health` call triggered by the "Despertar" button fails or does not resolve within 15 seconds, the system MUST stop waiting silently and surface an error state with a manual retry — no automatic background retries, no indefinite hang.

#### Scenario: Health check times out

- GIVEN the `despertando` overlay is visible after a "Despertar" click
- WHEN `GET /api/health` has not resolved within 15 seconds
- THEN the system MUST abandon the wait and show an error message with a "Reintentar" button
- AND MUST NOT retry automatically in the background

#### Scenario: Health check fails outright

- GIVEN the `despertando` overlay is visible
- WHEN `GET /api/health` rejects (network error or non-2xx) before the 15s timeout
- THEN the system MUST show the same error + "Reintentar" state immediately, without waiting out the 15s timeout or the 30s floor

#### Scenario: Retry re-enters despertando

- GIVEN the error state is showing
- WHEN the user clicks "Reintentar"
- THEN the system MUST re-send `GET /api/health` and re-enter `despertando`, restarting the 30s floor from this new attempt

### Requirement: Login Flow Reconciliation

`Login.jsx` MUST show a neutral loading state (no free-tier branding) for the duration of the login POST, since role and tier are unknown until the response resolves. After the response, the system MUST reconcile into the correct final state.

#### Scenario: SISTEMA or non-free-tier store resolves immediately

- GIVEN the login response indicates the user is SISTEMA, or the store has `isFreeTier=false`
- WHEN the response arrives
- THEN the system MUST dismiss the neutral loading state and navigate immediately
- AND MUST NOT show the branded `despertando` overlay at any point

#### Scenario: Free-tier non-SISTEMA login extends into branded overlay

- GIVEN the login response indicates a non-SISTEMA user on an `isFreeTier=true` store
- WHEN the response arrives before the 30s floor (measured from submit) has elapsed
- THEN the system MUST switch from the neutral loading state into the branded `despertando` overlay
- AND MUST hold navigation until the 30s floor (from submit) is reached, then auto-dismiss and navigate

### Requirement: SISTEMA Full Exemption

SISTEMA MUST NOT see the `asleep` or `despertando` overlay in any state, on any store, including during SISTEMA's own login.

#### Scenario: SISTEMA login on a free-tier store

- GIVEN a SISTEMA user logs into a store with `isFreeTier=true`
- WHEN the login POST is sent and resolves
- THEN the system MUST show, at most, the neutral (unbranded) loading state
- AND MUST NOT show the branded `despertando` overlay or the 30s floor

#### Scenario: SISTEMA idle on any store

- GIVEN a SISTEMA session is idle past the threshold on any store
- WHEN a `visibilitychange` or `focus` event fires
- THEN the system MUST NOT show the `asleep` overlay

### Requirement: Idle Detection via lastRequestAt

The system MUST update `lastRequestAt` on every successful API response via the existing `axiosSetup.js` response interceptor, and MUST compare elapsed idle time against `Date.now()` only in response to `visibilitychange`/`focus` events — never via a running timer or polling loop. `lastRequestAt` MUST be held in memory only, with no `localStorage` persistence.

#### Scenario: No background timer is used

- GIVEN the overlay idle-detection hook is mounted
- WHEN no `visibilitychange` or `focus` event occurs
- THEN the system MUST NOT re-evaluate idle state on any `setInterval`/polling schedule

#### Scenario: Reload or new tab is covered without localStorage

- GIVEN a free-tier user reloads the page or opens a new tab after 20 minutes of idle
- WHEN the SPA mounts and `checkSession()` runs
- THEN `checkSession()`'s own request MUST refresh `lastRequestAt` and act as a wake trigger
- AND the system is NOT required to persist `lastRequestAt` across reloads/tabs to satisfy this case

### Requirement: Mid-Task Interruption Accepted (v1)

The system MUST apply the overlay uniformly regardless of unsaved form state or active work screens; no exemption is required for v1.

#### Scenario: Idle threshold hit mid-form

- GIVEN a cashier has an unsaved form open
- WHEN the idle threshold is reached and the tab regains focus
- THEN the `asleep` overlay MUST still appear and block interaction, with no special-casing for unsaved work

## Non-Requirements (Explicit Non-Goals for v1)

- Native mobile apps or any API client other than the `stock-controll-main` web SPA.
- Commercial upsell CTA copy in the overlay — v1 copy is purely informational.
- Per-store configurable wait duration — 30s is fixed for all free-tier stores.
- "First login of the day" detection — every login is treated uniformly.
- Exempting specific "active work" screens from the block.

## Scope Boundary

This spec covers the `stock-controll-main` web SPA only, including mobile browsers via responsive CSS. It does not cover any native app, third-party API client, or other delivery surface.
