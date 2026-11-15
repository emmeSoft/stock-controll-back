# Auth Token Transport Specification

## Purpose

Defines how the backend issues, transports, and verifies the main session
JWT and the short-lived sudo elevation JWT. Cookie-based auth is removed
entirely — no cookie issuance, no cookie-read fallback, no `clearCookie`
calls anywhere on the auth surface. This is an atomic cutover to
`Authorization: Bearer` (no transition window): only test accounts exist
today, so backend/frontend deploy together and any temporary breakage from
deploy-order skew is an accepted risk, not something engineered around.

## Requirements

### Requirement: Session Token Issuance

The system MUST return the session JWT in the response body of
`POST /api/auth/login` and the password-setup endpoint, and MUST NOT set
any `token` cookie on either response. The token MUST expire 5 hours after
issuance.

#### Scenario: Successful login returns a bearer-ready token

- GIVEN valid credentials
- WHEN `POST /api/auth/login` succeeds
- THEN the response body contains a JWT signed with a 5h expiry
- AND no `Set-Cookie` header is present

#### Scenario: Password setup returns a bearer-ready token

- GIVEN a valid password-setup request
- WHEN it completes successfully
- THEN the response body contains a JWT signed with a 5h expiry
- AND no `Set-Cookie` header is present

### Requirement: Session Token Verification

`authMiddleware` MUST authenticate requests solely via the
`Authorization: Bearer` header — there MUST be no cookie-read branch of
any kind. Requests with a missing, malformed, or expired/invalid token
MUST be rejected with 401. The password-setup controller MUST use this
same check instead of reading `req.cookies` directly.

#### Scenario: Valid bearer header authenticates

- GIVEN a request carries a valid `Authorization: Bearer <jwt>` header
- WHEN `authMiddleware` runs
- THEN the request MUST be authenticated

#### Scenario: Missing or invalid token is rejected

- GIVEN a request has no `Authorization` header, or an invalid/expired one
- WHEN `authMiddleware` runs
- THEN the request MUST be rejected with 401

#### Scenario: Password setup honors the same check

- GIVEN a password-setup request with a valid Bearer header
- WHEN the controller runs
- THEN it MUST succeed without reading `req.cookies` directly

### Requirement: Sudo Elevation Token Issuance

`POST /api/auth/sudo` MUST return a separate JWT in the response body,
scoped with `{ purpose: 'sudo' }` and a 2-minute expiry, on successful
password confirmation, and MUST NOT set a `sudo` cookie.

#### Scenario: Sudo confirmation issues a scoped token

- GIVEN the authenticated user confirms their password correctly
- WHEN `POST /api/auth/sudo` completes
- THEN the response body contains a JWT with `purpose: 'sudo'` and a
  2-minute expiry
- AND no `Set-Cookie` header is present

### Requirement: Sudo Elevation Verification

`verifySudoMode` MUST verify the `x-sudo-token` header only — there MUST be
no `req.cookies.sudo` read path — denying by default when the header is
missing, malformed, expired, or lacks `purpose: 'sudo'`. The role check
MUST still execute before any password comparison (HIGH-004).

#### Scenario: Valid sudo header allows the elevated operation

- GIVEN a request carries a valid, unexpired `x-sudo-token`
- WHEN an ADMIN/SISTEMA-gated operation runs
- THEN `verifySudoMode` MUST allow it

#### Scenario: Missing or invalid sudo header denies by default

- GIVEN `x-sudo-token` is absent, malformed, or expired
- WHEN an elevated operation is attempted
- THEN `verifySudoMode` MUST deny it

#### Scenario: Role check still precedes password comparison

- GIVEN a request targets role promotion or creation
- WHEN `verifySudoMode` and the controller process it
- THEN the role check MUST execute before any password comparison

### Requirement: CORS Credential Mode

The server MUST NOT enable credentialed CORS (`credentials: true`), since
no cookie is ever transported cross-origin.

#### Scenario: Cross-origin request has no credential exchange

- GIVEN a cross-origin request from an allowed origin
- WHEN the CORS middleware responds
- THEN it MUST NOT send `Access-Control-Allow-Credentials: true`

### Requirement: Logout No-Op

`POST /api/auth/logout` MUST return a success response without performing
any server-side state mutation and without any `clearCookie` call, since no
cookie is ever set and the JWT is stateless.

#### Scenario: Logout always succeeds

- GIVEN any authenticated or unauthenticated request
- WHEN `POST /api/auth/logout` is called
- THEN it MUST return a success response
- AND no server-side session state is altered
