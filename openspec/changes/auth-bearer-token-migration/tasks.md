# Tasks: Auth Bearer Token Migration — Backend (PR B)

> Paired PR: `stock-controll-main` (PR F). Deploy B then F immediately; both target `main` directly — no tracker branch. Strict TDD active: `npm run test:integrity` (`tests/run-all.js`) hits the LIVE `DATABASE_URL` — never point it at production.

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~330–430 (source ~70–90; new tests ~260–340 — `auth-token.test.js` pure JWT, no DB, ~40-70 lines per `tests/money/money.test.js` (73 lines); `auth-middleware.test.js`/`sudo-mode.test.js` are DB-backed but have NO concurrency/race logic, so they should follow the plain straightforward DB-assertion precedent — `tests/scenarios/sale-create-invalid-payment-amount.test.js` (101 lines), `tests/scenarios/validate-payments-fixed-tolerance.test.js` (90 lines) — NOT the concurrency precedent (`payment-race.test.js`, 202 lines, inflated by race-condition synchronization logic and long prose comments documenting a flaky-test fix that doesn't apply here) |
| 400-line budget risk | Low-Medium (corrected down from High — see note below) |
| Chained PRs recommended | No — already resolved as 1 of 2 independent, standalone PRs (no further split; cookie removal spans one controller file) |
| Suggested split | Single PR B, as decided |
| Delivery strategy | ask-on-risk |
| Chain strategy | size-exception (likely, pending confirmation once actual test files are written) |

Decision needed before apply: Yes (confirm once real line count is in, likely still needs size:exception at the top of the range)
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: Medium

Correction: the original ~480-600 estimate sized ALL 3 new test files by the DB-backed house-style convention. `auth-token.test.js` needs no DB at all (pure JWT sign/verify) — resized to the pure-unit precedent (`tests/money/money.test.js`, 73 lines) instead. This PR still cannot be usefully split further (design already rejected splitting main-token from sudo — same controller file, tests land with their code per Strict TDD). Recommend confirming `size:exception` for PR B once implementation lands, since the top of the corrected range (~480) still edges over budget.

## Phase 1: Token Service
- [x] 1.1 [RED] Write `tests/auth/auth-token.test.js` (pure, no DB — follow `tests/money/money.test.js`'s plain style, not the DB-backed convention): `signAuthToken` issues a 5h-expiry JWT; `signSudoToken(userId)` issues `{id,purpose:'sudo'}` with 2m expiry; `verifySudoToken` round-trips. Expect fail.
- [x] 1.2 [GREEN] `services/authServices.js`: change `signAuthToken` expiry `1h`→`5h`; add + export `signSudoToken`, `verifySudoToken`.
- [x] 1.3 Register `auth-token.test.js` in `tests/run-all.js`; run `npm run test:integrity`.

## Phase 2: Session Auth (header-only, purpose guard)
- [x] 2.1 [RED] Write `tests/auth/auth-middleware.test.js` (DB-backed): `login`/`setupPassword` return `token`/`setupToken` in body with no `Set-Cookie`; `authMiddleware` authenticates a valid Bearer header, rejects missing/malformed/expired/`purpose`-carrying tokens with 401. Expect fail.
- [x] 2.2 [GREEN] `middlewares/authMiddleware.js`: delete the `req.cookies?.token` read (header-only); reject tokens carrying `purpose` before the DB lookup.
- [x] 2.3 [GREEN] `controllers/authController.js`: delete `buildCookieOptions` and all `res.cookie` calls in `login`/`setupPassword`; `setupPassword` reads the Bearer header instead of `req.cookies`.
- [x] 2.4 Register `auth-middleware.test.js` in `tests/run-all.js`; run `npm run test:integrity`.

## Phase 3: Sudo Elevation
- [x] 3.1 [RED] Write `tests/auth/sudo-mode.test.js`: `verifySudo` returns `sudoToken` in body with no `Set-Cookie`; a non-privileged role gets 403 before any password compare (HIGH-004); `verifySudoMode` matrix — valid / missing / malformed / expired / wrong-purpose / other-user's token; `logout` returns 200 with no `clearCookie` call. Expect fail.
- [x] 3.2 [GREEN] `controllers/authController.js`: `verifySudo` returns `{ message, sudoToken }` via `signSudoToken`; `logout` → `res.json({ message })`, drop both `res.clearCookie` calls.
- [x] 3.3 [GREEN] `services/employeeServices.js`: `verifySudoMode(req)` reads `req.headers['x-sudo-token']`, denies unless valid, unexpired, `purpose==='sudo'`, and `decoded.id===req.user.id`; same thrown `Error`, same 4 call sites untouched.
- [x] 3.4 Register `sudo-mode.test.js` in `tests/run-all.js`; run `npm run test:integrity`.

## Phase 4: CORS, Config, Gate
- [x] 4.1 `index.js`: remove the `cookieParser` require + `app.use`; remove `credentials: true` from the `cors()` options object; keep `trust proxy`.
- [x] 4.2 `openspec/config.yaml`: set `strict_tdd: true`; Test Runner → `npm run test:integrity` (house-style plain-node scripts, no framework).
- [x] 4.3 Grep gate: zero hits for `req.cookies`, `res.cookie`, `clearCookie`, `cookieParser`, `credentials: true` in source (excluding `tests/`). (Also found and removed 4 dangling `res.clearCookie('sudo')` calls in `controllers/employeeController.js` — not listed in design's File Changes table, but required by the gate since the `sudo` cookie no longer exists to clear.)
- [x] 4.4 Run full `npm run test:integrity`; confirm all 3 new auth test files plus the existing suite pass.
