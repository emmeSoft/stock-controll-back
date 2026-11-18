# Proposal: Free Tier Sleep Overlay

## Intent

The backend runs on Render's free plan: it sleeps after 15 minutes without HTTP traffic and takes ~50s to cold-start. Trial users sent to the app read that silence as "the app is broken". We make the slowness **explained** instead of confusing, and we keep it as a permanent, deliberate upsell lever: `isFreeTier` is a **subscription-tier signal per store, decoupled from real infra state**. After the owner upgrades Render (which happens the moment the first store pays), stores still flagged `isFreeTier=true` keep experiencing the simulated delay.

## Scope

### In Scope
- `store.isFreeTier` Boolean field; only SISTEMA can toggle it.
- Idempotent wake endpoint (`GET /api/health`) — none exists today.
- `isFreeTier` exposed in the auth payload via `buildUserPayload`.
- One global overlay component, mounted once at the SPA root, two states.
- Idle tracking via `lastRequestAt`, evaluated on `visibilitychange`/`focus`.
- Responsive CSS (same SPA is opened in mobile browsers).

### Out of Scope / Non-Goals
- Commercial upsell CTA copy in v1 — message is purely informational.
- Native mobile app or any other API client.
- Per-store configurable wait — fixed 30s for all free-tier stores.
- Exempting "active work" screens from the block.
- Detecting "first login of the day" — every login is treated uniformly.

## Capabilities

### New Capabilities
- `store-tier-configuration`: SISTEMA-only `isFreeTier` flag per store, surfaced to clients.
- `free-tier-sleep-overlay`: overlay states, idle detection, minimum wait.

### Modified Capabilities
- None.

## Approach

**Tier flag.** Follow the existing `maxDiscountPct` precedent exactly — no new pattern, no new RBAC permission:

| Layer | Precedent | Change |
|---|---|---|
| `src/pages/Stores.jsx` (L20-23) | `if (isSistema)` pushes field + column | one more conditional field/column |
| `services/storesServices.js` (L95-97) | `if (isSistema) allowedFields.push(...)` | one more entry — **authoritative gate** |

Frontend hiding is cosmetic only; the server whitelist is the real boundary.

**Overlay states.**

| State | Trigger | UI |
|---|---|---|
| `asleep` | `now - lastRequestAt >= 15min`, no wake request in flight | sleeping-robot art, informational Spanish copy, **"Despertar"** button → hits the idempotent health endpoint (never a mutating route) |
| `despertando` | a wake request is in flight (button click **or** a login submit) | message + animation, no button, auto-dismiss on resolve |

For `isFreeTier=true`, `despertando` enforces a **30-second minimum display**, racing the real request against a 30s timer (`Promise.all`). This floor is permanent by design, independent of actual backend speed.

**Login.** Every free-tier login goes straight to `despertando` — submitting the login *is* the wake request, so the `asleep` button state is skipped.

**SISTEMA exemption.** SISTEMA never sees the overlay, in either state, on any store — support and admin work must stay uninterrupted.

**Idle detection.** `lastRequestAt` is refreshed on every successful API response (the existing `src/utils/axiosSetup.js` response interceptor is the single chokepoint) and compared against `Date.now()` on `visibilitychange`/`focus`. Explicitly **not** a `setInterval` loop: browsers throttle and pause timers in background tabs and during OS sleep, which makes a naive timer unreliable.

**Accepted for v1.** If the 15-minute threshold is reached while a cashier has an unsaved form open, the overlay still appears and blocks. No special-casing.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `back/prisma/schema.prisma` | Modified | `isFreeTier` on `model store` (near L20) |
| `back/services/storesServices.js` | Modified | `allowedFields` gate under `isSistema` |
| `back/services/authServices.js` | Modified | `buildUserPayload` exposes `isFreeTier` |
| `back/` routes | New | Idempotent health/wake endpoint |
| `main/src/pages/Stores.jsx` | Modified | SISTEMA-only field + column |
| `main/src/utils/axiosSetup.js` | Modified | `lastRequestAt` on successful responses |
| `main/src/App.jsx` | Modified | Mount overlay at root |
| `main/src/pages/Login.jsx` | Modified | Neutral loading state on submit; reconcile into branded overlay post-response |
| `main/src/components/` | New | Overlay component + idle hook |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Overlay blocks SISTEMA during support work | Med | Hard exemption by role, asserted in tests |
| Wake button triggers a mutating call | Low | Dedicated idempotent GET endpoint only |
| Shared backend sleeps from *another* store's inactivity, so a paid store still hits a real cold start | Low | **Accepted non-issue** — Render is upgraded the instant the first store pays. Do not design code around this interim window. |
| 30s floor perceived as a bug by paying users | Low | Floor applies only to `isFreeTier=true` |

## Rollback Plan

The schema change is additive. Unmount the overlay from `App.jsx` and the feature disappears with no data migration; `isFreeTier` can stay in the database unused. The health endpoint is inert if unused.

## Dependencies

- Render free plan behavior (15 min idle → sleep) for the 15-minute threshold.
- Sleeping-robot art asset.

## Success Criteria

- [ ] Only SISTEMA can read/write `isFreeTier`; a non-SISTEMA attempt is dropped server-side.
- [ ] After 15 min idle, returning to the tab shows `asleep` with a working "Despertar".
- [ ] Login on a free-tier store shows `despertando` for **at least** 30s, even if the API answers in 1s.
- [ ] SISTEMA never sees the overlay in any state.
- [ ] Overlay is legible and usable on a phone browser.
- [ ] Flipping `isFreeTier=false` removes both states for that store immediately.

## Resolved Decisions (closed 2026-11-16)

1. **Pre-login tier/role conflict.** `App.jsx`'s existing `isInitializing` screen ("Cargando Stock Control...") only covers the bootstrap `checkSession()` call on mount — it does **not** cover the actual login form submit. Verified: `Login.jsx`'s `handleLogin` has zero loading feedback today (no spinner, button stays enabled) during `axios.post('/api/auth/login', ...)`. Resolution: add a neutral loading state to `handleLogin` (same visual language as the bootstrap screen, no free-tier branding) for the duration of the POST. Once the response resolves, if `!isSistema && isFreeTier`, extend into the branded `despertando` overlay for the remaining time up to the 30s floor (measured from submit, not from response) before navigating to `/mainpanel`. SISTEMA and paid-tier stores navigate immediately on response — SISTEMA never sees the branded overlay. This is new in-scope work, added to Affected Areas below.
2. **`lastRequestAt` persistence.** Memory-only, no `localStorage`. `checkSession()` already runs on every mount (reload or new tab), which refreshes `lastRequestAt` itself and doubles as a wake trigger — same mechanism as login. No gap.
3. **Default value.** `@default(true)` in the Prisma schema, applied to both new and existing stores via the migration — correct given nobody has paid yet.
