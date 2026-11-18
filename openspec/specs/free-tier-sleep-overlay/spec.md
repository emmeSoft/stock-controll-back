# Free Tier Sleep Overlay Specification

## Purpose

Render's free plan sleeps the backend after 15 minutes idle, with a real cold-start ceiling of ~50s. This spec defines `store.isFreeTier` as a per-store subscription-tier signal (deliberately decoupled from real infra state — it stays the deciding factor even once the backend never actually sleeps again) and the global frontend overlay that explains the resulting delay to non-SISTEMA users on free-tier stores, with SISTEMA exempt from the idle-triggered overlay entirely.

## Requirements

### Requirement: SISTEMA-Only Tier Flag

The system MUST expose `store.isFreeTier` as a Boolean, server-side-gated field. Only the SISTEMA role MUST be able to read or write it; frontend field/column visibility is cosmetic only — the authoritative gate is the server `allowedFields` whitelist in `storesServices.js` (same pattern as `maxDiscountPct`). An unrecognized write value (not boolean `true`/`false` or string `"true"`/`"false"`) MUST be left untouched rather than silently coerced to `false`.

#### Scenario: Non-SISTEMA write attempt is dropped server-side

- GIVEN a non-SISTEMA user sends a store update request containing `isFreeTier`
- WHEN the request reaches `storesServices.js`
- THEN the server MUST silently drop `isFreeTier` from the allowed update fields
- AND MUST NOT change the stored value

#### Scenario: New store defaults to free tier

- GIVEN a new store is created
- WHEN the record is persisted
- THEN `isFreeTier` MUST default to `true`

#### Scenario: SISTEMA toggle takes effect immediately

- GIVEN a store has `isFreeTier = true`
- WHEN SISTEMA sets it to `false`
- THEN both overlay states MUST stop appearing for that store on the next request, with no further migration needed

### Requirement: Idempotent Wake Endpoint

The system MUST provide an idempotent `GET /api/health` endpoint with no side effects, mounted before the global rate limiter, used exclusively to "wake" a sleeping backend instance.

#### Scenario: Health endpoint never mutates state

- GIVEN the backend is asleep or awake
- WHEN `GET /api/health` is called any number of times
- THEN the response MUST NOT alter any persisted data
- AND the overlay's "Despertar" button MUST call only this endpoint, never a mutating route

### Requirement: Overlay — Asleep State

For a non-SISTEMA user on an `isFreeTier=true` store, the system MUST show the `asleep` overlay state when idle time has reached the 15-minute threshold and no wake request is already in flight.

#### Scenario: Idle threshold reached while tab is backgrounded then refocused

- GIVEN `now - lastRequestAt >= 15min`
- AND no wake request is currently in flight
- WHEN the user triggers a `visibilitychange` or `focus` event (e.g. returns to the tab)
- THEN the system MUST display the `asleep` overlay with informational Spanish copy and a "Despertar" button
- AND the button, when clicked, MUST call `GET /api/health` and transition to `despertando`

### Requirement: Overlay — Despertando State

For a non-SISTEMA user on an `isFreeTier=true` store, the system MUST show the `despertando` overlay state while a wake request (health-check click or login submit) is in flight, with no button, and MUST enforce a 30-second minimum display measured from when the wake-trigger started — independent of real backend speed.

#### Scenario: Wake triggered by "Despertar" click

- GIVEN the `asleep` overlay is visible
- WHEN the user clicks "Despertar"
- THEN the system MUST switch to `despertando` with no button
- AND MUST keep it visible for at least 30 seconds from the click, even if `GET /api/health` resolves sooner
- AND MUST auto-dismiss once both the request has resolved AND the 30s floor has elapsed

#### Scenario: Wake triggered by login submit

- GIVEN a free-tier, non-SISTEMA user submits the login form
- WHEN the login POST is sent
- THEN the system MUST treat the submit itself as the wake trigger, showing `despertando` immediately (not after the response), and start the 30s floor from that moment

### Requirement: Wake Request Failure Handling

If the `GET /api/health` call triggered by the "Despertar" button fails or does not resolve within 60 seconds, the system MUST stop waiting silently and surface an error state with a manual retry — no automatic background retries, no indefinite hang. 60 seconds is chosen with margin above Render free-tier's real cold-start ceiling (~50s), so a genuinely booting backend is not mistaken for a failure.

#### Scenario: Health check times out

- GIVEN the `despertando` overlay is visible after a "Despertar" click
- WHEN `GET /api/health` has not resolved within 60 seconds
- THEN the system MUST abandon the wait and show an error message with a "Reintentar" button
- AND MUST NOT retry automatically in the background

#### Scenario: Health check fails outright

- GIVEN the `despertando` overlay is visible
- WHEN `GET /api/health` rejects (network error or non-2xx) before the 60s timeout
- THEN the system MUST show the same error + "Reintentar" state immediately, without waiting out the 60s timeout or the 30s floor

#### Scenario: Retry re-enters despertando

- GIVEN the error state is showing
- WHEN the user clicks "Reintentar"
- THEN the system MUST re-send `GET /api/health` and re-enter `despertando`, restarting the 30s floor from this new attempt

### Requirement: Login Flow Shows the Overlay Immediately

`Login.jsx` MUST show the `despertando` overlay immediately on submit, before role/tier are known, so the overlay covers the real cold-start wait end-to-end rather than hiding it behind generic loading text that only resolves after the wait is already over. After the response, the system MUST reconcile into the correct final state.

#### Scenario: SISTEMA or non-free-tier store resolves immediately

- GIVEN the login response indicates the user is SISTEMA, or the store has `isFreeTier=false`
- WHEN the response arrives
- THEN the system MUST dismiss the `despertando` overlay and navigate immediately, with no 30s floor applied

#### Scenario: Free-tier non-SISTEMA login holds the branded overlay

- GIVEN the login response indicates a non-SISTEMA user on an `isFreeTier=true` store
- WHEN the response arrives before the 30s floor (measured from submit) has elapsed
- THEN the system MUST keep the `despertando` overlay visible
- AND MUST hold navigation until the 30s floor (from submit) is reached, then auto-dismiss and navigate

### Requirement: SISTEMA Exemption

SISTEMA MUST NOT see the `asleep` overlay, ever, on any store — this is structurally guaranteed by excluding SISTEMA from idle detection entirely. SISTEMA MAY briefly see the `despertando` overlay during their own slow login (that copy carries no free-tier branding) — it MUST be dismissed immediately with no 30s floor once the response confirms their role.

#### Scenario: SISTEMA login on a free-tier store

- GIVEN a SISTEMA user logs into a store with `isFreeTier=true`
- WHEN the login POST is sent
- THEN the system MAY show the `despertando` overlay for the real duration of the request
- AND WHEN the response arrives, MUST dismiss it immediately with no 30s floor applied

#### Scenario: SISTEMA idle on any store

- GIVEN a SISTEMA session is idle past the threshold on any store
- WHEN a `visibilitychange` or `focus` event fires
- THEN the system MUST NOT show the `asleep` overlay
- AND this holds even while SISTEMA is using the app's "simular rol" feature to preview as another role

### Requirement: Idle Detection via lastRequestAt

The system MUST update `lastRequestAt` on every successful API response via the `axiosSetup.js` response interceptor, and MUST compare elapsed idle time against `Date.now()` only in response to `visibilitychange`/`focus` events — never via a running timer or polling loop (background tabs and OS sleep throttle timers unreliably). `lastRequestAt` MUST be held in memory only, with no `localStorage` persistence — a reload or new tab is already covered because `checkSession()` runs on every mount and itself acts as a wake trigger.

#### Scenario: No background timer is used

- GIVEN the overlay idle-detection hook is mounted
- WHEN no `visibilitychange` or `focus` event occurs
- THEN the system MUST NOT re-evaluate idle state on any `setInterval`/polling schedule

#### Scenario: Re-triggering asleep is suppressed while a wake is in flight

- GIVEN `wakeStore.phase` is `despertando` or `error` (a wake already in flight or just failed)
- WHEN a `visibilitychange` or `focus` event fires and the idle threshold is still exceeded
- THEN the system MUST NOT re-promote the phase to `asleep`, to avoid two concurrent wake attempts racing to write the shared phase

## Non-Requirements (Explicit Non-Goals for v1)

- Native mobile apps or any API client other than the `stock-controll-main` web SPA.
- Commercial upsell CTA copy in the overlay — copy is purely informational.
- Per-store configurable wait duration — 30s is a fixed floor for all free-tier stores.
- "First login of the day" detection — every login is treated uniformly.
- Exempting specific "active work" screens from the idle block — the overlay applies even with an unsaved form open.

## Scope Boundary

This spec covers the `stock-controll-main` web SPA only, including mobile browsers via responsive CSS. It does not cover any native app, third-party API client, or other delivery surface.
