# Design: Free Tier Sleep Overlay

## Technical Approach

Three thin seams, no new infrastructure:

1. **DB → auth payload**: `store.isFreeTier` is written only through the existing SISTEMA `allowedFields` whitelist and read by the SPA only through the auth payload (`login` + `/api/auth/check`). No new endpoint for reading tier.
2. **Wake channel**: one new unauthenticated, DB-free `GET /api/health`.
3. **SPA**: one global `<SleepOverlay />` driven by a non-persisted zustand store plus a memory-only `wakeTracker` module. The axios response interceptor is the single write point for `lastRequestAt`.

## Verified Pre-Conditions (read before designing)

| Finding | Consequence for this design |
|---|---|
| `controllers/authController.js` `checkAuth` (L68-91) builds its payload **inline** and does **not** `include: { store: true }` — it does not use `buildUserPayload` | Must add `include: { store: true }` AND route `checkAuth` through `buildUserPayload`, or `isFreeTier` is missing after every F5 |
| `checkAuth` returns `lastName`; `buildUserPayload` does not. `userStore.partialize` reads `state.user.lastName` | `buildUserPayload` must gain `lastName` too, otherwise unifying regresses the persisted profile |
| `storesServices.create` `allowedFields` (L13-19) has **no** `isSistema` branch | `isFreeTier` is dropped on create by design; new stores rely on `@default(true)` |
| `DynamicForm.jsx` supports only `select` + plain `input`, and performs **no** value coercion (L317-353) | UI sends `"true"`/`"false"` strings. Boolean coercion must happen server-side in `storesServices.update` |
| `index.js` mounts a global limiter (1000 req / 15 min / IP) at L87, before all routes | `/api/health` is mounted **before** the limiter |
| `userStore.partialize` deliberately excludes `role`/`storeId` | `isFreeTier` is likewise never persisted; it lives only in the in-memory `user` |
| No `routes/health*` exists (confirmed, 15 route files) | New route file, not an extension |
| `stock-controll-main/package.json` has **no** test runner (dev/build/lint/preview only) | Frontend logic must be extracted to a plain module to stay testable; see Testing Strategy |

## Architecture Decisions

### Decision: `checkAuth` adopts `buildUserPayload`
**Choice**: Extend `buildUserPayload` with `lastName` + `isFreeTier`, then have `checkAuth` call it with `include: { rbacRole: true, store: true }`.
**Alternatives considered**: Duplicate the `isFreeTier` field in `checkAuth`'s inline literal.
**Rationale**: Two payload builders already drifted once (`lastName`). One builder means the tier signal cannot be present at login and absent after reload.

### Decision: `/api/health` is mounted before the global limiter and touches no DB
**Choice**: `app.use('/api/health', healthRoutes)` placed above `app.use(limiter)`; handler returns a static object.
**Alternatives considered**: Mount with the other routes; add a Prisma `SELECT 1`.
**Rationale**: The wake request is the one call that must never fail — a busy multi-terminal store behind one NAT IP must not spend its POS budget on wake pings. The endpoint does zero IO, so exempting it is cheap. A DB probe would also make "wake the web process" fail for an unrelated reason.

### Decision: Boolean coercion is server-side only
**Choice**: Normalize `isFreeTier` to a real Boolean inside `storesServices.update`, after the role check.
**Alternatives considered**: Coerce in `DynamicForm`.
**Rationale**: The service whitelist is already the authoritative boundary (per proposal). Touching `DynamicForm` would change behaviour for every entity in the app.

### Decision: SISTEMA exemption keys on the real role, ignoring `simulatedRole`
**Choice**: `isSistema = user?.role === 'SISTEMA' || user?.rbacRole === 'SISTEMA'` (same expression as `Stores.jsx` L6); `useUserStore.simulatedRole` is not consulted.
**Alternatives considered**: Respect simulation so SISTEMA can preview the overlay.
**Rationale**: Spec requires SISTEMA never be blocked "in any state, on any store". Support work must not be interrupted by a role the operator is only simulating.

### Decision: Overlay mounts below the `isInitializing` gate
**Choice**: `<SleepOverlay />` renders inside `ThemeProvider`, as a sibling of `<RouterProvider>`, i.e. after `App.jsx`'s existing `isInitializing` early return.
**Alternatives considered**: Mount above the gate.
**Rationale**: During bootstrap the only persisted user data is name/avatar — tier and role are unknown, so any tier decision would be a guess. The existing "Cargando Stock Control..." screen already covers that window.

### Decision: Wake floor via `Promise.all` with rejection absorbed
**Choice**: Absorb request rejection into a value before `Promise.all`, then re-surface it.
**Alternatives considered**: Bare `Promise.all([request, timer])`.
**Rationale**: `Promise.all` short-circuits on rejection — a failed health call would otherwise skip the 30s floor and flash the overlay.

### Decision: Wake failure surfaces a dedicated `error` phase with manual retry
**Choice**: The "Despertar" wake handler races `GET /api/health` against a 15s timeout (`Promise.race`, not `withWakeFloor`). On timeout or outright rejection, transition `wakeStore.phase` to `'error'` and stop — no automatic background retry. A "Reintentar" button re-runs the exact same handler, which re-enters `despertando` and restarts the 30s floor from that new attempt.
**Alternatives considered**: Silent auto-retry loop; let the request hang indefinitely under the 30s floor logic.
**Rationale**: `withWakeFloor` is for the *happy path* floor — it must not be reused for failure, or a dead backend would hang the overlay forever with no user-visible signal. 15s < 30s so failure is always detected before the floor would have hidden it anyway. User chose the simplest option: no silent retries.
**Note**: This path only applies to the button-triggered wake. The login-triggered wake (`Login.jsx`) only calls `withWakeFloor(Promise.resolve(), startedAt)` *after* the login POST already resolved successfully — there is nothing left that can fail at that point, so no separate error handling is needed there.

### Decision: Frontend verification is manual in v1
**Choice**: Put all testable logic in `src/utils/wakeTracker.js` (pure, no React, no DOM) and verify overlay behaviour manually against the spec scenarios.
**Alternatives considered**: Introduce Vitest + Testing Library.
**Rationale**: The SPA has no test runner today; adding one is a separate change with its own config/CI surface. Backend units stay fully covered by the house runner.

## Data Flow

    SISTEMA ─ PUT /api/stores/:id {isFreeTier} ─→ storesServices.update
                                                   (isSistema ? whitelist + coerce : drop)
                                                            │
                                                      store.isFreeTier
                                                            │
                 login / auth-check ──→ buildUserPayload ───┘
                                               │
                                     userStore.user (memory only)
                                               │
                                        ┌──────┴───────┐
                                  SleepOverlay     Login.jsx
                                        │               │
                            useBackendIdle          beginWake(startedAt)
                        (visibilitychange/focus)        │
                                        │               │
                                   wakeStore.phase ──────┘
                                        │
                      'asleep' ──click──→ GET /api/health ──→ withWakeFloor(30s) ──→ 'idle'

    every successful axios response ──→ wakeTracker.markRequest()

## File Changes

### `stock-controll-back`

| File | Action | Description |
|------|--------|-------------|
| `prisma/schema.prisma` | Modify | Add `isFreeTier Boolean @default(true)` to `model store`, directly under `maxDiscountPct` (L20) |
| `prisma/migrations/20261116_store_is_free_tier/migration.sql` | Create | Hand-written, idempotent (house convention: never run against the live DB without explicit human go-ahead) |
| `services/storesServices.js` | Modify | `update()` L95-97: push `isFreeTier` into the SISTEMA branch + Boolean coercion |
| `services/authServices.js` | Modify | `buildUserPayload` L32-40: add `lastName`, `isFreeTier` |
| `controllers/authController.js` | Modify | `checkAuth` L68-91: `include: { rbacRole: true, store: true }`, return `buildUserPayload(user)` |
| `controllers/healthController.js` | Create | Static, side-effect-free handler |
| `routes/healthRoutes.js` | Create | `router.get('/', healthController.check)` — no `authMiddleware`, no `requirePermission` |
| `index.js` | Modify | Require + `app.use('/api/health', healthRoutes)` **above** `app.use(limiter)` (L87) |
| `tests/tier/store-free-tier-gate.test.js` | Create | House-style node script |
| `tests/tier/health-endpoint.test.js` | Create | House-style node script |
| `tests/run-all.js` | Modify | Register the two new scripts |

### `stock-controll-main`

| File | Action | Description |
|------|--------|-------------|
| `src/utils/wakeTracker.js` | Create | Memory-only `lastRequestAt`, thresholds, `withWakeFloor` |
| `src/store/wakeStore.js` | Create | Non-persisted zustand overlay phase store |
| `src/hooks/useBackendIdle.js` | Create | `visibilitychange`/`focus` idle evaluation |
| `src/components/SleepOverlay.jsx` | Create | Both overlay states, themed + responsive |
| `src/assets/sleeping-robot.svg` | — | **Not created in v1.** Owner chose a CSS/emoji placeholder (e.g. 🤖💤) instead of a real illustration, to unblock `tasks` — swappable later with no logic change |
| `src/utils/axiosSetup.js` | Modify | Success branch of the response interceptor (L47) calls `markRequest()` |
| `src/App.jsx` | Modify | Mount `<SleepOverlay />` inside `ThemeProvider`, after the `isInitializing` return |
| `src/pages/Login.jsx` | Modify | `isSubmitting` neutral state + post-response reconciliation |
| `src/pages/Stores.jsx` | Modify | SISTEMA-only field + column (L20-23 block) |
| `src/pages/Details/components/EntityDetailsForm.jsx` | Modify (found during manual verify) | `isFreeTier` rendered as free text here, not via `Stores.jsx`'s field config — this is a separate detail/edit renderer. Added a dedicated `select` branch (Sí/No), same pattern as the file's existing `role`/`categoryId` special cases. |

## Interfaces / Contracts

### Prisma + migration

```prisma
isFreeTier      Boolean          @default(true) // Señal de plan (no estado real de infra). Solo SISTEMA.
```

```sql
-- Postgres backfills existing rows to true as part of ADD COLUMN ... NOT NULL DEFAULT.
ALTER TABLE "store" ADD COLUMN IF NOT EXISTS "isFreeTier" BOOLEAN NOT NULL DEFAULT true;
```

### `storesServices.update` gate

```js
if (isSistema) {
    allowedFields.push("maxDiscountPct", "isFreeTier");
}

// DynamicForm envía strings; el whitelist es la frontera autoritativa, acá normalizamos.
if (cleanData.isFreeTier !== undefined) {
    cleanData.isFreeTier = cleanData.isFreeTier === true || cleanData.isFreeTier === "true";
}
```

### `GET /api/health`

```
Request:  no auth header, no body, no query
200:      { "status": "ok", "service": "stock-controll-back", "timestamp": "<ISO>" }
```
No DB access, no writes, no logging side effects. Safe to call unlimited times.

### `buildUserPayload` additions

```js
lastName: user.lastName,
isFreeTier: user.store?.isFreeTier ?? true   // sin store (SISTEMA) -> irrelevante, el rol exime
```

### `src/utils/wakeTracker.js`

```js
export const IDLE_THRESHOLD_MS = 15 * 60 * 1000;
export const WAKE_FLOOR_MS = 30 * 1000;

let lastRequestAt = Date.now();                       // memoria únicamente, nunca localStorage
export const markRequest = () => { lastRequestAt = Date.now(); };
export const getIdleMs = () => Date.now() - lastRequestAt;

export const withWakeFloor = async (promise, startedAt = Date.now()) => {
  const remaining = Math.max(0, WAKE_FLOOR_MS - (Date.now() - startedAt));
  // El rechazo se absorbe como valor: Promise.all corta en reject y saltearía el piso de 30s.
  const [settled] = await Promise.all([
    promise.then(v => ({ ok: true, v }), e => ({ ok: false, e })),
    new Promise(r => setTimeout(r, remaining))
  ]);
  if (!settled.ok) throw settled.e;
  return settled.v;
};
```

### `src/store/wakeStore.js`

```js
// zustand sin persist: el tier es señal sensible y volátil, igual que role/storeId en userStore.
{
  phase: 'idle' | 'asleep' | 'despertando' | 'error',
  wakeStartedAt: null | number,
  setAsleep: () => void,                 // solo desde useBackendIdle
  beginWake: (startedAt?: number) => void,
  endWake: () => void,
  setError: () => void,                  // despertando -> error, tras timeout/rechazo
}
```

### `useBackendIdle()`

Called from inside `SleepOverlay`. Takes no arguments, returns nothing.

- Computes `isSistema` / `isFreeTier` from `useUserStore(state => state.user)`.
- If `isSistema || !isFreeTier || !user` → registers no listeners (effect body returns early, dependency array includes both flags so a tier toggle re-registers on the next payload).
- Otherwise registers `document.addEventListener('visibilitychange')` and `window.addEventListener('focus')`; handler promotes `idle → asleep` when `document.visibilityState === 'visible' && getIdleMs() >= IDLE_THRESHOLD_MS`.
- Evaluates once on mount. **No `setInterval`, no polling** — background tabs and OS sleep throttle timers.
- Cleanup removes both listeners.

### `<SleepOverlay />`

Props: **none** — self-contained. Renders `null` when `phase === 'idle'`.

| phase | Renders | Guard |
|---|---|---|
| `asleep` | art + copy + "Despertar" button | only reachable via `useBackendIdle` (already tier/role-checked) |
| `despertando` | copy + animation, **no button** | rendered whenever phase is set; every caller verifies tier/role before `beginWake` |
| `error` | copy + "Reintentar" button | only reached from a failed/timed-out wake attempt; retry re-runs the same handler |

Wake handler (button only — timeout races ahead of the 30s floor so failure never waits it out):

```js
const WAKE_TIMEOUT_MS = 15 * 1000;

const wake = async () => {
  const startedAt = Date.now();
  beginWake(startedAt);
  try {
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), WAKE_TIMEOUT_MS));
    // OJO: no envolver esta carrera en withWakeFloor. withWakeFloor absorbe el
    // rechazo en un valor resuelto antes de su propio Promise.all, así que un
    // fallo esperaría igual el piso de 30s completo antes de mostrar error
    // (bug real encontrado en sdd-verify, corregido acá). El piso solo se
    // aplica DESPUÉS de confirmar éxito — mismo patrón que Login.jsx.
    await Promise.race([axios.get('/api/health'), timeout]);
    await withWakeFloor(Promise.resolve(), startedAt);
    endWake();                      // markRequest() ya corrió en el interceptor
  } catch {
    setError();                     // timeout o rechazo -> estado de error inmediato, sin piso, sin reintento automático
  }
};
// "Reintentar" en el estado error vuelve a llamar exactamente a wake().
```

Spanish copy (user-facing):

| Key | Text |
|---|---|
| asleep title | `El servidor está en reposo` |
| asleep body | `Tu plan gratuito pone el servidor en reposo luego de 15 minutos sin actividad. Despertarlo demora unos segundos.` |
| asleep button | `Despertar` |
| despertando title | `Despertando el servidor...` |
| despertando body | `Esto puede demorar hasta 30 segundos. No cierres esta ventana.` |
| error title | `No pudimos despertar el servidor` |
| error body | `Puede ser una conexión lenta. Probá de nuevo en unos segundos.` |
| error button | `Reintentar` |

Layout: `fixed inset-0 z-[9999]` flex-centered, `p-4`, card `w-full max-w-sm`, art `w-32 sm:w-48`, colors from `useTheme()` (`theme.bg` / `theme.bg2` / `theme.text`) exactly as `Login.jsx` does — legible on a phone browser without a separate mobile branch.

### `Login.jsx` reconciliation

```js
const startedAt = Date.now();
setIsSubmitting(true);
try {
  const res = await axios.post("/api/auth/login", { email, password });
  if (res.data.requiresPasswordChange) { /* rama actual intacta, navega ya */ }

  setToken(res.data.token);
  setUser(res.data.user);

  const u = res.data.user;
  const exempt = u.role === 'SISTEMA' || !u.isFreeTier;
  if (exempt) { navigate("/mainpanel"); return; }      // nunca ve el overlay branded

  setIsSubmitting(false);                              // cede el control al overlay global
  beginWake(startedAt);                                // piso de 30s desde el SUBMIT
  try { await withWakeFloor(Promise.resolve(), startedAt); } finally { endWake(); }
  navigate("/mainpanel");
} catch (err) { /* manejo de error actual */ }
finally { setIsSubmitting(false); }
```

Neutral loading state = disabled `ThemedButton` with label `Ingresando...`, inputs disabled, no robot art and no free-tier wording (role/tier unknown until the response resolves).

### `Stores.jsx` addition

```js
fields.push({ name: "isFreeTier", label: "Plan gratuito (servidor en reposo)", type: "select",
              options: [{ value: "true", label: "Sí" }, { value: "false", label: "No" }] });
columns.push({ header: "Plan gratuito", accessorKey: "isFreeTier" });
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit (back) | `storesServices.update`: SISTEMA pushes `isFreeTier`; non-SISTEMA drops it; `"false"` coerces to `false` | `tests/tier/store-free-tier-gate.test.js`, house-style `assert()` + `process.exit(1)` |
| Unit (back) | `buildUserPayload` exposes `isFreeTier` for both login and `checkAuth` shapes | same script |
| Integration (back) | `GET /api/health` → 200, no auth required, repeated calls leave data untouched, mounted before the limiter | `tests/tier/health-endpoint.test.js` via the exported `app` |
| Unit (front) | `withWakeFloor` honours the floor from `startedAt`, and still waits the floor when the promise rejects; `getIdleMs` | Pure module — no runner exists today, so logic is isolated in `wakeTracker.js` ready for one |
| Manual (front) | The 8 spec scenarios: idle→asleep on refocus, SISTEMA exempt (incl. while simulating a role), free-tier login ≥30s, paid login immediate, `isFreeTier=false` clears both states, phone layout, health timeout → error + Reintentar, retry re-enters despertando | Scripted manual pass recorded in `sdd-verify` |

New backend scripts must be registered in `tests/run-all.js`.

## Migration / Rollout

Additive, single nullable-free column with a DB-side default — Postgres backfills existing rows to `true` in the same statement, satisfying the backfill scenario with no `UPDATE`. Following house convention, the SQL is hand-written and **not** executed against the deployed Supabase database without explicit human go-ahead. Rollback: remove `<SleepOverlay />` from `App.jsx`; the column and the health route become inert with no data migration.

## Open Questions

None. All proposal questions were closed on 2026-11-16.
