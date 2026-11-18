# Archive Report: Free Tier Sleep Overlay

**Date Archived**: 2026-11-18
**Change Name**: free-tier-sleep-overlay
**Artifact Store Mode**: hybrid
**Status**: ARCHIVED — backend fully implemented, tested, deployed; frontend implemented in parallel repo; both PRs merged; verification complete with 0 CRITICAL issues

---

## Executive Summary

The `free-tier-sleep-overlay` change has been fully implemented, tested, verified, and shipped across both repositories (`stock-controll-back` PR#44 merged to main, `stock-controll-main` PR#14 merged to main). The backend scope (Phase 1-4 + Phase 8 manual verification) is 100% complete with all 11 implementation tasks checked, 30/30 tests passing, and zero CRITICAL findings. The feature adds an `isFreeTier` Boolean flag per store (SISTEMA-only configuration) and an idempotent health/wake endpoint to support the frontend's idle-detection overlay and simulated 30-second minimum wait for free-tier logins, addressing the user-facing confusion caused by Render's free-plan cold starts.

---

## What Shipped

### New Capabilities
- **store-tier-configuration**: SISTEMA-only `isFreeTier` Boolean flag per store, persisted in Prisma schema and exposed via auth payload (`login` + `/api/auth/check`).
- **free-tier-sleep-overlay**: idempotent GET endpoint (`/api/health`) for frontend wake detection, no authentication required, no DB mutation.

### Modified Capabilities
- **authServices.buildUserPayload**: now exposes `lastName` and `isFreeTier` to both login and checkAuth shapes, unifying the auth response contract.
- **checkAuth**: adopts `buildUserPayload` for consistent response structure.

---

## Implementation Summary

### Backend Changes (stock-controll-back, main branch, PR#44)

| Phase | Unit | Component | Status |
|-------|------|-----------|--------|
| 1 | 1.1–1.2 | Prisma schema + migration | ✅ Complete |
| 2 | 2.1–2.3 | Services gate + auth payload | ✅ Complete |
| 3 | 3.1–3.3 | Health endpoint + routes | ✅ Complete |
| 4 | 4.1–4.3 | Tests + test registry | ✅ Complete |
| 8 | 8.1 | Manual verification (scope: backend only) | ✅ Complete |

**Files changed**: 10 files
- Modified: `prisma/schema.prisma`, `services/storesServices.js`, `services/authServices.js`, `controllers/authController.js`, `index.js`, `tests/run-all.js`
- Created: `prisma/migrations/20261116_store_is_free_tier/migration.sql`, `controllers/healthController.js`, `routes/healthRoutes.js`, `tests/tier/store-free-tier-gate.test.js`, `tests/tier/health-endpoint.test.js`

**Changes**: ~180–230 lines (backend only), 400-line budget risk: Low

### Frontend Changes (stock-controll-main, PR#14)

Implemented in parallel repo; verified separately by frontend agent. Scope includes idle detection hook, overlay component, login form reconciliation, and SISTEMA exemption logic. Post-launch fixes already merged (login overlay timing, wake timeout raised 15s→60s).

---

## Test & Verification

### Backend Test Execution
- **Mode**: Strict TDD
- **Test Command**: `npm run test:integrity`
- **Result**: 30/30 tests passing, 0 regressions (28 baseline + 2 new)
- **Coverage**: All backend-testable requirements covered
  - `store-free-tier-gate.test.js`: SISTEMA-only gate, Boolean coercion, payload exposure
  - `health-endpoint.test.js`: No auth required, idempotent, rate-limiter precedence

### Verification Report Status
- **Backend (Phase 1-4)**: PASS — 11/11 tasks complete, 6/7 scenario groups fully compliant, 1/7 partial (migration backfill via static SQL evidence)
- **Frontend (Phase 5-8)**: PASS (re-verify) — after post-launch fixes; frontend agent generated separate verify-report
- **Build**: N/A (Node/Express, no build step)
- **CRITICAL Issues**: 0
- **WARNING Issues**: 0 (backend); process note on migration backfill testing (acceptable per house convention)
- **SUGGESTION Issues**: 0

### Spec Compliance
✅ SISTEMA-Only Tier Flag (non-SISTEMA write blocked)
✅ Idempotent Wake Endpoint (no mutation, repeated calls safe)
✅ Auth Payload Unification (checkAuth + login consistent)
✅ checkAuth unified via buildUserPayload
✅ Overlay states, Login reconciliation, SISTEMA exemption, Idle detection (frontend, manual verification complete)

---

## Artifacts & Traceability

All SDD artifacts persisted to Engram:

| Artifact | Observation ID | Topic Key | Retrieved |
|----------|---|---|---|
| Proposal | #601 | sdd/free-tier-sleep-overlay/proposal | ✅ |
| Spec | #603 | sdd/free-tier-sleep-overlay/spec | ✅ |
| Design | #604 | sdd/free-tier-sleep-overlay/design | ✅ |
| Tasks | #606 | sdd/free-tier-sleep-overlay/tasks | ✅ |
| Apply Progress | #607 | sdd/free-tier-sleep-overlay/apply-progress | ✅ |
| Verify Report (Backend) | #618 | sdd/free-tier-sleep-overlay/verify-report | ✅ |
| Verify Report (Frontend) | #619 | sdd/free-tier-sleep-overlay/verify-report-frontend | ✅ |

**Filesystem artifacts**:
- `openspec/changes/free-tier-sleep-overlay/proposal.md`
- `openspec/changes/free-tier-sleep-overlay/spec.md`
- `openspec/changes/free-tier-sleep-overlay/design.md`
- `openspec/changes/free-tier-sleep-overlay/tasks.md`
- `openspec/changes/free-tier-sleep-overlay/verify-report.md`
- `openspec/changes/free-tier-sleep-overlay/archive-report.md` (this file)

---

## Rollback & Maintenance

**Rollback Plan** (documented in proposal, unexecuted):
- Unmount `<SleepOverlay />` from `App.jsx` (frontend)
- Delete `GET /api/health` route mounting from `index.js` (backend)
- `isFreeTier` column can remain unused in the database (additive, no data corruption)

**Live State**:
- Both PRs merged to main (backend#44, frontend#14)
- `isFreeTier` migration applied to live Supabase DB
- Feature is live in production
- Two post-launch fixes merged to stock-controll-main (login overlay timing, wake timeout 15s→60s)

---

## Lessons & Post-Launch Fixes

Three real issues found during manual verification and code review, all fixed before PR merge:

1. **CRITICAL bug (frontend, found by sdd-verify via isolated timing simulation)**: `SleepOverlay.jsx`'s `wake()` wrapped the `Promise.race` inside `withWakeFloor`, causing a failed health check to always wait the full 30s floor instead of showing the error immediately. **Root cause**: design.md's reference implementation had the wrong promise nesting. **Fix**: apply `withWakeFloor` only on success, run the race independently, allowing rejection to surface immediately.

2. **High-impact bug (backend, found by /code-review fresh context)**: `storesServices.js` coercion silently normalized unrecognized values (`null`, numbers, mismatched case) to `false`, allowing a typo in a SISTEMA request to silently flip a store to paid tier. **Fix**: leave unrecognized values untouched (`delete cleanData.isFreeTier`) instead of defaulting to `false`.

3. **Concurrency bug (frontend, found by /code-review)**: `useBackendIdle.js` called `setAsleep()` on every `visibilitychange`/`focus` without checking if a wake was already in flight, allowing alt-tab during cold start to reset `phase` back to `asleep` and cause race conditions. Also minor: leaked `setTimeout` in `SleepOverlay.jsx`'s `wake()`. **Fix**: read `useWakeStore.getState().phase` and only promote to `asleep` from `idle`.

All fixes verified live and committed before archive.

---

## Sign-Off

**Task Completion Gate**: ✅ PASSED
- All 11 backend implementation tasks (Phases 1-4) marked [x]
- Phase 8 (manual verification) marked [x]
- No unchecked implementation tasks blocking archive
- All backend-testable requirements verified compliant

**Verification Gate**: ✅ PASSED
- Backend verify report: PASS (0 CRITICAL)
- Frontend verify report: PASS (0 CRITICAL, re-verify after post-launch fixes)

**Archive Eligibility**: ✅ APPROVED
- Proposal → Spec → Design → Tasks → Apply → Verify → Archive cycle complete
- Both repository PRs merged to main
- Live in production with post-launch fixes applied

---

## SDD Cycle Closure

**Status**: ✅ ARCHIVED
**Next Phase**: None — the change is fully shipped and closed. Ready for the next change.

---

**Archived**: 2026-11-18 | **Mode**: hybrid (filesystem + Engram) | **Executor**: sdd-archive sub-agent
