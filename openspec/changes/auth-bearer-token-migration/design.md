# Design: Auth Bearer Token Migration — Backend

> **Cross-repo design.** Paired half: `stock-controll-main/openspec/changes/auth-bearer-token-migration/design.md`.
> Specs: `auth-token-transport` (here), `auth-session-client` (frontend).
> Supersedes the earlier dual-issue/dual-accept design — see *Rollout*.

## Technical Approach

Transport-only change on the existing JWT path. No new library, no new module: the sudo token is a
third sibling of the `signAuthToken` / `signPasswordSetupToken` helpers already in
`services/authServices.js`, signed with the same `jwt.sign` + `JWT_SECRET`.

**Big-bang, no fallback.** There are no real users yet (test accounts only), so the cookie path is
*deleted*, not deprecated: no `res.cookie`, no `clearCookie`, no `req.cookies` read, no
`cookieParser`. Every removed branch is a branch nobody has to review, test or later clean up.

## Architecture Decisions

| Decision | Choice | Rejected | Rationale |
|---|---|---|---|
| Rollout shape | Big-bang: cookies removed in the same change | Dual-issue + dual-accept transition | No live users to protect. Dual-accept costs a fallback branch in every verifier plus a follow-up cleanup change — pure waste here. Cost: backend and frontend must land together (accepted, see *Rollout*) |
| Sudo token identity | `{ id, purpose: 'sudo' }`, 2 min; `verifySudoMode` asserts `decoded.id === req.user.id` | Unbound `{ purpose: 'sudo' }` | One extra condition closes an admin-A-token-replayed-by-admin-B hole the `sudo=true` cookie had |
| Sudo lifecycle | Separate JWT | Claim inside the main 5h JWT | Keeps two lifetimes out of the hottest auth path (locked in the proposal) |
| setup-password transport | Reuses the **same** `Authorization: Bearer` slot; the `purpose` claim discriminates | Dedicated `x-setup-token` header | Mirrors exactly what the `token` cookie already did; zero new contract, zero extra frontend storage |
| `authMiddleware` purpose guard | Reject any token carrying a `purpose` claim | Leave as-is | Sharing one transport slot makes the pre-existing "setup token passes as a session token" hole trivially reachable. One line, in a file already being rewritten |
| CORS | `credentials: true` removed in the same change | Time it around the proxy revert | Nothing left to protect; `Authorization` / `x-sudo-token` are non-simple headers but `x-store-id` already proves the preflight path works, and `cors` reflects requested headers by default |
| `cookieParser` | Removed from `index.js` | Keep "just in case" | Zero `req.cookies` reads remain. `trust proxy` stays — `express-rate-limit` needs the real IP |
| `/api/auth/logout` | Kept as a 200 no-op | Delete route + controller + frontend call | Preserves the public contract and the only hook a future token blocklist would need; the body is two lines |
| Tests | House-style plain-node scripts in `tests/auth/`, registered in `tests/run-all.js` | A test framework | No new infra (locked); fake `req`/`res` objects as in `tests/money/serializer.test.js` |

## Data Flow

```
login / setup-password ──> 200 body { token | setupToken, user }      (no Set-Cookie)

request ──> authMiddleware: Authorization: Bearer <jwt>
              └─> jwt.verify ──> reject if decoded.purpose ──> DB isActive ──> req.user

POST /api/auth/sudo ──> role check (HIGH-004) ──> bcrypt ──> body { sudoToken }
elevated op ────────> verifySudoMode(req): x-sudo-token ──> verify + purpose==='sudo'
                                                         ──> decoded.id === req.user.id ──> allow
```

## File Changes

| File | Action | Description |
|---|---|---|
| `services/authServices.js` | Modify | `expiresIn: '1h'` → `'5h'`; add + export `signSudoToken(userId)` (2 min) and `verifySudoToken(token)` |
| `controllers/authController.js` | Modify | Delete `buildCookieOptions` and every `res.cookie`; `login` returns `token` / `setupToken` in the body; `setupPassword` reads the Bearer header; `verifySudo` returns `sudoToken`; `logout` → `200 { message }` |
| `middlewares/authMiddleware.js` | Modify | Delete the `req.cookies?.token` branch (header-only); reject tokens with a `purpose` claim |
| `services/employeeServices.js` | Modify | `verifySudoMode(req)` verifies `x-sudo-token` (purpose + id binding); same thrown `Error`, same 4 call sites untouched |
| `controllers/employeeController.js` | Modify | Remove 4 dangling `res.clearCookie('sudo')` calls — found by the grep gate, not anticipated here originally |
| `index.js` | Modify | Drop `cookieParser` require + `app.use`; CORS `credentials: true` removed; keep `trust proxy`; guard `app.listen` behind `require.main === module` and `module.exports = app`, so the real app is importable for the CORS test below without a structural refactor |
| `tests/auth/auth-token.test.js` | Create | Claims + expiry of both token kinds |
| `tests/auth/auth-middleware.test.js` | Create | Fake req/res: valid header, missing, tampered, expired, `purpose`-carrying token |
| `tests/auth/sudo-mode.test.js` | Create | `verifySudoMode` matrix (valid / missing / expired / wrong purpose / other user's token) + HIGH-004 ordering |
| `tests/auth/cors-credentials.test.js` | Create | Real HTTP request (ephemeral port, real `app`) with an `Origin` header; asserts `Access-Control-Allow-Credentials` is absent. Closes the verify-phase CRITICAL gap — this scenario had no runtime test before. |
| `tests/run-all.js` | Modify | Register the four files |
| `openspec/config.yaml` | Modify | Testing block → `npm run test:integrity` |

## Interfaces

```js
// authServices.js
signSudoToken   = (userId) => jwt.sign({ id: userId, purpose: 'sudo' }, JWT_SECRET, { expiresIn: '2m' });
verifySudoToken = (token)  => jwt.verify(token, JWT_SECRET); // caller asserts purpose + id
```

`POST /api/auth/login` → `{ message, user, token }` | `{ message, requiresPasswordChange, user, setupToken }`
`POST /api/auth/setup-password` → `{ message, user, token }` · `POST /api/auth/sudo` → `{ message, sudoToken }`
`POST /api/auth/logout` → `200 { message }` (confirmation only; stateless)

## Testing Strategy

| Layer | What | How |
|---|---|---|
| Unit | Token claims/expiry, `authMiddleware` token branches incl. the purpose guard, `verifySudoMode` matrix, HIGH-004 ordering (role 403 before any bcrypt/prisma call) | Fake `req`/`res`, no DB |
| Integration | `authMiddleware` happy path (DB user lookup, `isActive`, store override untouched) | Live `DATABASE_URL`, existing runner — **never point it at production** |
| Grep gate | `req.cookies`, `res.cookie`, `cookieParser`, `credentials: true` → 0 hits | Before PR |

## Migration / Rollout

**One backend PR** (`B`). The source diff is small and tightly coupled — cookie removal spans
`login`, `setupPassword`, `verifySudo` and `logout` in the same file, so splitting main-token from
sudo would touch `buildCookieOptions` twice for no reviewer benefit. Tests land with their code
(Strict TDD), so they are not a separate slice either.

The frontend PR (`F`, other repo) is the second and last slice — separate only because it is a
separate repo and a separate deploy.

Deploy order: merge + deploy **B**, then **F** immediately. Auth is broken between the two deploys —
**accepted**: test accounts only, no real users. Rollback: revert both PRs together.

No schema change, no data migration, no persisted session state to invalidate (JWTs are stateless;
existing cookies simply stop being read).

## Open Questions

- [ ] None blocking.
