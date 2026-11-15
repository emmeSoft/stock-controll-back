# Proposal: Auth Bearer Token Migration (Backend)

> **Cross-repo change.** Paired proposal lives at
> `stock-controll-main/openspec/changes/auth-bearer-token-migration/proposal.md`.
> Backend and frontend MUST ship together — see *Risks*.

## Intent

httpOnly cookie auth is broken in Chrome. The frontend (`*.vercel.app`) and the backend
(`*.onrender.com`) are different sites, so Chrome blocks the `token` cookie as third-party
right after login and kicks the user's session. A same-origin Vercel proxy rewrite (PR #9)
was merged as a stopgap; this change replaces it rather than keeping it.

Move the auth transport from cookies to `Authorization: Bearer <jwt>`. Same JWT, same
signing path — only the transport changes. Cookies stop being load-bearing anywhere.

## Scope

### In Scope

- `login` / `setup-password` return the JWT in the **response body**; stop setting the `token` cookie.
- Main session JWT expiry `1h` → `5h` (`signAuthToken`). This becomes the ONLY place session length is governed.
- `authMiddleware` reads the `Authorization: Bearer` header only (the fallback already exists; the cookie branch is removed).
- **Sudo replacement**: `POST /api/auth/sudo` returns a separate short-lived JWT (2 min, `{ purpose: 'sudo' }`) in the body. `verifySudoMode()` verifies an `x-sudo-token` header instead of `req.cookies.sudo`.
- `setupPassword` stops reading `req.cookies?.token` directly; aligned to the same header-based pattern.
- `authMiddleware` rejects any token carrying a `purpose` claim, so a setup/sudo token can never be replayed as a session token now that they share one transport slot.
- `/api/auth/logout` kept as a **no-op confirmation** endpoint (JWT is stateless; no blocklist exists or is added) — no `clearCookie`, nothing left to clear.
- Remove `credentials: true` from CORS and drop `cookieParser` **in this same change** — no cookie path survives anywhere (no `res.cookie`, no `req.cookies`, no fallback branch).
- **New automated coverage** for login / authMiddleware / sudo flow — today this surface has ZERO tests.

### Out of Scope

- Token refresh or rotation. None exists today (no silent refresh at any tier); "re-login on expiry" is unchanged.
- Token blocklist / server-side revocation.
- RBAC logic (`rbacMiddleware` reads `req.user` + `x-store-id` only — untouched).
- Folding sudo into the main JWT as a claim (**rejected**: mixes two lifecycles into the hottest, most security-sensitive path).

## Capabilities

### New Capabilities

- `auth-token-transport`: how the main session JWT and the sudo elevation JWT are issued, transported, and verified.

### Modified Capabilities

- None.

## Approach

1. `authServices.js`: `expiresIn: '1h'` → `'5h'`; add `signSudoToken` / `verifySudoToken` (2 min, `purpose: 'sudo'`).
2. `authController.js`: return tokens in bodies (`login`, `setupPassword`, `verifySudo`); delete `buildCookieOptions` usage; `logout` → 200 no-op.
3. `authMiddleware.js`: header-only read (cookie branch deleted, not reordered); reject tokens with a `purpose` claim.
4. `employeeServices.js`: `verifySudoMode(req)` verifies `req.headers['x-sudo-token']`.
5. `index.js`: CORS `credentials: false`, remove `cookieParser`.
6. Tests first (Strict TDD) for every step above.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `services/authServices.js` | Modified | 5h expiry, sudo token sign/verify |
| `controllers/authController.js` | Modified | Body tokens, no cookies, no-op logout |
| `middlewares/authMiddleware.js` | Modified | Header-only auth |
| `services/employeeServices.js` | Modified | `verifySudoMode` reads `x-sudo-token` |
| `index.js` | Modified | CORS `credentials` off, drop `cookieParser` |
| `tests/` | New | First coverage of the auth surface |
| `openspec/config.yaml` | Modified | Stale testing block (`test:integrity` exists) |

## Review Workload Forecast

| Metric | Estimate |
|--------|----------|
| Backend source lines | ~80 (net negative outside tests — cookie code is deleted) |
| Backend test lines | ~250–350 (new, additive) |
| Backend PR total | ~330–430 |
| Frontend PR total | ~60–100 |

- **400-line budget risk: Medium** — the backend PR sits at the budget edge, and the overage is
  additive test code, which is cheap to review.
- **Chained PRs recommended: Yes** — exactly two, one per repo (`B` backend, then `F` frontend).
  Backend is **not** split further: dropping the dual-accept transition removed the only reason to
  separate main-token from sudo, and cookie removal spans both in the same controller file.
- **Decision needed before apply: Yes** (`ask-on-risk`) — confirm the 2-PR shape and, if the backend
  PR lands above 400 lines, accept `size:exception` for its test block.

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Cross-repo deploy skew — old frontend cookie-code vs new backend (or vice versa) breaks login entirely | Accepted | No real users yet (test accounts only). Backend and frontend deploy in the same window; if order is briefly misaligned, test sessions may break temporarily — accepted, not engineered around (no dual-accept transition period). |
| Sudo replacement is the highest-risk single piece (gates ADMIN/SISTEMA creation & promotion); zero header path exists today | Medium | TDD first; verify role-check-before-password ordering (HIGH-004) is preserved; deny-by-default if `x-sudo-token` is absent/invalid/expired |
| No existing regression safety net on the auth surface | High | Closed by this change — tests are in scope, written before implementation |
| Tests run against the LIVE `DATABASE_URL` (`npm run test:integrity`) | Medium | Never point the runner at production; use a dedicated test database |
| Longer 5h session widens the window of a stolen token | Low | Accepted tradeoff: sessionStorage is tab-scoped; no refresh mechanism extends it further |

## Rollback Plan

Revert the backend commits (restores cookie issuance + `credentials: true`) **and** the paired
frontend commits in the same window. Partial rollback of one repo breaks login — both or neither.
No data migration, no schema change, nothing to undo server-side.

## Dependencies

- Frontend repo must ship the paired change in the same deploy window.
- `ALLOWED_ORIGINS` must stay correct — CORS still enforces origin, just without `credentials`.
- `openspec/config.yaml` testing block is stale and should be refreshed to `npm run test:integrity`.

## Success Criteria

- [ ] Login succeeds in Chrome with zero cookies set by the backend.
- [ ] `authMiddleware` rejects requests without a valid `Authorization: Bearer` header.
- [ ] Sudo-gated employee ops succeed only with a valid, unexpired `x-sudo-token`, and fail without it.
- [ ] `setup-password` works via header, not `req.cookies`.
- [ ] A `purpose`-carrying token (setup or sudo) is rejected by `authMiddleware`.
- [ ] `grep` for `req.cookies`, `res.cookie`, `clearCookie`, `cookieParser` and `credentials: true` returns zero hits in the backend.
- [ ] `npm run test:integrity` covers login, authMiddleware, and the sudo flow, and passes.
