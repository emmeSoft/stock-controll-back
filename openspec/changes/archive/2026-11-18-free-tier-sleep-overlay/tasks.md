# Tasks: Free Tier Sleep Overlay

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | Backend ~180-230; Frontend ~260-320 (each is its own PR per repo) |
| 400-line budget risk | Low (both repos) |
| Chained PRs recommended | No |
| Suggested split | PR 1 = `stock-controll-back`; PR 2 = `stock-controll-main` (depends on PR 1 merged/deployed for correct runtime behavior) |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Backend: schema, service gate, auth payload, health endpoint, tests | PR 1 (`stock-controll-back`) | Standalone, deployable alone (frontend unaffected until it ships) |
| 2 | Frontend: wake tracking, overlay, wiring | PR 2 (`stock-controll-main`) | Needs PR 1's `isFreeTier` field live to behave correctly end-to-end; code review can proceed in parallel |

## Phase 1: Backend Foundation (`stock-controll-back`)

- [x] 1.1 Add `isFreeTier Boolean @default(true)` to `model store` in `prisma/schema.prisma`, under `maxDiscountPct`.
- [x] 1.2 Create `prisma/migrations/20261116_store_is_free_tier/migration.sql` — hand-written `ALTER TABLE ... ADD COLUMN IF NOT EXISTS "isFreeTier" BOOLEAN NOT NULL DEFAULT true`. Do not run against live DB.

## Phase 2: Backend Core

- [x] 2.1 `services/storesServices.js`: in `update()`, push `isFreeTier` into the SISTEMA-only `allowedFields` branch; coerce `cleanData.isFreeTier` to real Boolean (`=== true || === "true"`).
- [x] 2.2 `services/authServices.js`: add `lastName` and `isFreeTier: user.store?.isFreeTier ?? true` to `buildUserPayload`.
- [x] 2.3 `controllers/authController.js`: `checkAuth` fetches with `include: { rbacRole: true, store: true }` and returns `buildUserPayload(user)` instead of its inline literal.

## Phase 3: Backend Wake Endpoint

- [x] 3.1 Create `controllers/healthController.js` — static handler, no DB access, returns `{ status: "ok", service: "stock-controll-back", timestamp }`.
- [x] 3.2 Create `routes/healthRoutes.js` — `router.get('/', healthController.check)`, no `authMiddleware`, no `requirePermission`.
- [x] 3.3 `index.js`: require and mount `app.use('/api/health', healthRoutes)` above `app.use(limiter)` (L87).

## Phase 4: Backend Tests

- [x] 4.1 Create `tests/tier/store-free-tier-gate.test.js` — SISTEMA writes `isFreeTier`, non-SISTEMA write is dropped, `"false"` string coerces to `false`; also assert `buildUserPayload` exposes `isFreeTier` for both login and `checkAuth` shapes.
- [x] 4.2 Create `tests/tier/health-endpoint.test.js` — `GET /api/health` returns 200 with no auth, repeated calls leave data untouched, route resolves before the rate limiter.
- [x] 4.3 Register both new scripts in `tests/run-all.js`.

## Phase 5: Frontend Foundation (`stock-controll-main`)

- [ ] 5.1 Create `src/utils/wakeTracker.js` — `IDLE_THRESHOLD_MS`, `WAKE_FLOOR_MS`, in-memory `lastRequestAt`, `markRequest()`, `getIdleMs()`, `withWakeFloor()` (absorb rejection before `Promise.all` per design).
- [ ] 5.2 Create `src/store/wakeStore.js` — non-persisted zustand store: `phase` (`idle|asleep|despertando|error`), `wakeStartedAt`, `setAsleep`, `beginWake`, `endWake`, `setError`.

## Phase 6: Frontend Hook & Overlay

- [ ] 6.1 Create `src/hooks/useBackendIdle.js` — reads `isSistema`/`isFreeTier` from `userStore`; skips listener registration when exempt; registers `visibilitychange`/`focus` listeners (no polling); promotes `idle → asleep` at threshold; cleans up listeners.
- [ ] 6.2 Create `src/components/SleepOverlay.jsx` — `asleep` (art/copy/"Despertar") and `despertando` (copy/animation, no button) states, Spanish copy per design, themed via `useTheme()`, renders `null` on `idle`.
- [ ] 6.3 Add `error` phase to `SleepOverlay.jsx` — wake handler races `GET /api/health` against a 15s timeout (`Promise.race`), on timeout/rejection calls `setError()`; render error copy + "Reintentar" button that re-runs the same handler.

## Phase 7: Frontend Integration

- [ ] 7.1 `src/utils/axiosSetup.js`: success branch of the response interceptor (L47) calls `markRequest()`.
- [ ] 7.2 `src/App.jsx`: mount `<SleepOverlay />` inside `ThemeProvider`, after the `isInitializing` early return.
- [ ] 7.3 `src/pages/Login.jsx`: add neutral `isSubmitting` loading state (no free-tier branding); after response, exempt SISTEMA/non-free-tier navigates immediately; free-tier non-SISTEMA calls `beginWake(startedAt)` from submit time and `withWakeFloor(Promise.resolve(), startedAt)` before navigating.
- [ ] 7.4 `src/pages/Stores.jsx`: add SISTEMA-only `isFreeTier` select field (`DynamicForm`) and `"Plan gratuito"` column.

## Phase 8: Manual Verification

- [x] 8.1 Manual pass of the 8 spec scenarios — all passed live against the local dev stack (2026-11-17):
  - idle→asleep on refocus: confirmed via `Date.now()` override + `visibilitychange`/`focus` dispatch, exact copy matched.
  - SISTEMA exempt (incl. while simulating VENDEDOR via "MODO DE VISTA"): no overlay in either case, login or idle.
  - Free-tier login ≥30s floor: observed ~20-25s hold on "Despertando el servidor..." before navigating (floor confirmed, exact seconds not stopwatched to the ms).
  - Paid/SISTEMA login immediate: confirmed for SISTEMA and for a Ferretería user after the tier toggle.
  - `isFreeTier=false` clears both states: toggled Ferretería El Tornillo to `false` as SISTEMA, verified via DB round-trip and a logged-in session — no overlay on simulated idle.
  - Phone layout: live window resize was unreliable in the test environment (`resize_window` did not change `window.innerWidth`), so verified at the source level instead — `SleepOverlay.jsx` card is `w-full max-w-sm p-6` with `p-4` on the backdrop, no fixed pixel widths; fits a 390px viewport with margin.
  - Health timeout → error + Reintentar: killed the backend mid-`despertando`, got the exact "No pudimos despertar el servidor" + Reintentar copy, observed at ~15-19s elapsed. **Correction (post sdd-verify): this timing observation was wrong/unreliable** — my polling had unaccounted gaps between tool calls. `sdd-verify` found via an isolated, precise simulation that the error path actually always waited out the full ~30s floor regardless of how fast the failure occurred — see the CRITICAL bug below. The *outcome* (error + Reintentar eventually appears, with the right copy) was correctly observed; the *timing* claim was not trustworthy evidence and should not have been cited as covering the "fails outright, without waiting the floor" spec scenario.
  - Retry re-enters despertando: clicking Reintentar after restarting the backend re-entered `despertando` and resolved to `idle` after the floor.
  - **Bug found and fixed during this pass**: `isFreeTier` rendered as a plain text input (not the Sí/No select from the proposal) on the store detail/edit page — `EntityDetailsForm.jsx` is a *separate* form renderer from `Stores.jsx`'s `DynamicForm`-based create modal, and didn't know about the field's `type`/`options` metadata. Added a dedicated branch (same pattern as the existing `role`/`categoryId` special cases in that file). Not a security issue (server-side gate was already correct) but a real usability gap vs. the committed design.
  - **CRITICAL bug found by `sdd-verify` (frontend), fixed after this manual pass**: `SleepOverlay.jsx`'s `wake()` wrapped the `Promise.race([axios.get, timeout])` *inside* `withWakeFloor`. Since `withWakeFloor` absorbs rejection into an always-resolved value before its own `Promise.all`, a failed/timed-out wake always waited out the full 30s floor before showing the error — contradicting the spec's "Health check fails outright" requirement (which says the error must show "without waiting out the 15s timeout or the 30s floor"). Root cause was in `design.md`'s own reference code, not an apply deviation. Fixed: the race now runs on its own and can reject immediately; `withWakeFloor(Promise.resolve(), startedAt)` is applied only *after* confirming success, matching the pattern `Login.jsx` already used correctly.
  - **Re-verified post-fix with precise, single-script timing** (no cross-call gaps this time): backend killed outright → error shown at **~252ms** (near-instant, as intended). Backend restored → "Reintentar" → resolved to `idle` at **~30139ms** (the 30s floor, exactly as intended for the success path). Confirms the fix correctly separates the two paths.
  - **Pre-PR `/code-review` (fresh context, high effort) found 2 more real issues, both fixed**:
    1. (Backend) `storesServices.js`'s `isFreeTier` coercion silently normalized any unrecognized value (`null`, numbers, differently-cased strings) to `false` — a fat-fingered SISTEMA request could silently flip a store to paid-tier with no error. Fixed: unrecognized values are now left untouched (`delete cleanData.isFreeTier`) instead of defaulting to `false`.
    2. (Frontend) `useBackendIdle.js`'s `evaluateIdle()` called `setAsleep()` on every `visibilitychange`/`focus` with no check that a wake was already in flight — a user alt-tabbing during the ~50s Render cold start could reset `phase` back to `'asleep'` mid-`despertando`, and two concurrent `wake()` calls could then race to overwrite `wakeStore.phase`. Fixed: `evaluateIdle` now reads `useWakeStore.getState().phase` and only promotes to `'asleep'` from `'idle'`. Also fixed a minor leaked `setTimeout` in `SleepOverlay.jsx`'s `wake()` (not cleared when the health check won the race).
    (A third finding — `checkAuth`'s `role` fallback `null` → `'VENDEDOR'` — was re-flagged but is the already-known, already-accepted consequence of unifying auth payloads, documented since `sdd-apply`; not changed.)
    Backend test suite re-run: 30/30 green. Frontend lint re-run: unchanged at 88 pre-existing problems.
