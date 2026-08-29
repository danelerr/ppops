## `createApiApp` in `src/api/app.ts` (L148-L471)

**Purpose:** Defines the complete HTTP surface and the middleware order that
separates public checkout/health data from authenticated merchant operations.

**Inputs & Assumptions:**

- `dependencies.intents` and `dependencies.database`: trusted in-process service
  objects created by `PPOpsRuntime.create`.
- `dependencies.apiToken`: trusted secret loaded from an owner-only file.
- `dependencies.health`: trusted in-memory diagnostic callback.
- `dependencies.runtimeInfo`: fixed runtime metadata; optional for tests.
- `dependencies.rateLimit`: validated config in production, caller-supplied in
  tests.
- HTTP method/path/headers/body/query/source address: untrusted.
- Precondition: deployment topology makes the configured server binding
  appropriate. `PPOpsConfigSchema` requires explicit `allowRemote` for a
  non-loopback host (`src/config.ts:L124-L135`).

**Outputs & Effects:**

- Returns a Hono app with public static checkout/health routes and authenticated
  operational routes.
- `POST /v1/intents` creates durable intent/projection/idempotency state.
- `POST /v1/outbox/:eventId/replay` reschedules one existing dead-letter event.
- All other registered routes are read-only over app/database/health state.
- Adds security/cache headers, request body caps, and in-memory source-based
  fixed-window limits.

---

**Block-by-Block:**

```ts
// L156-L186
const app = new Hono();
...
app.use("*", secureHeaders());
app.use("/v1/*", /* no-store */);
app.use("/pay/*", /* rate, CSP, no-store, no-referrer */);
```

- **What:** Creates app-global security headers and a special public-checkout
  policy.
- **Why here:** These middlewares precede all matching routes.
- **Assumes:** `requestSource` represents a useful rate-limit key. It falls back
  to `unknown` (`L140-L146`); proxy identity handling is established by:
  **nothing found** in this function.
- **Establishes:** Public payer pages are rate-limited and cannot load arbitrary
  page resources under the emitted CSP.
- **Depended on by:** `/pay/:id` and request JSON availability.

```ts
// L188-L210
app.get("/assets/pay.css", ...);
app.get("/assets/pay.js", ...);
app.get("/pay/:id", ...);
app.get("/pay/:id/request.json", ...);
```

- **What:** Serves fixed assets and payer data selected by intent ID.
- **Why here:** These routes intentionally precede `/v1/*` authentication.
- **Assumes:** Random `pi_` identifiers are not discoverable by unintended
  parties. Established by: the Node `randomUUID` call at
  `src/intents/service.ts:L122-L125`; its entropy guarantee is an external
  runtime contract.
- **Establishes:** Unknown IDs return 404; valid IDs expose chain/token/amount,
  status, recipient, memo, descriptor, and signer but omit `externalReference`
  (`src/api/app.ts:L65-L82`).
- **Depended on by:** Browser checkout and payer `loadPaymentRequest`.

```ts
// L220-L252
app.get("/v1/health", ...);
app.get("/v1/live", ...);
app.get("/v1/ready", ...);
```

- **What:** Registers unauthenticated process/readiness endpoints.
- **Why here:** Registration before authentication makes them available to
  deployment probes.
- **Assumes:** The returned scan state is acceptable for unauthenticated
  disclosure under the selected network binding. Established by: **nothing
  found** in this function; this is a deployment/product-policy input.
- **Establishes:** Readiness is 503 until `railgunReady`; no database records or
  secret/provider URLs are included.
- **Depended on by:** Orchestrator/monitoring probes.

```ts
// L254-L282
app.use("/v1/*", /* API rate limit */);
app.use("/v1/*", bodyLimit({ maxSize: 64 * 1024, ... }));
app.use("/v1/*", async (...) => {
  if (!bearerTokenMatches(...)) return ...401;
  await next();
});
```

- **What:** Applies rate, size, and Bearer checks to routes registered after the
  middleware.
- **Why here:** All state/metrics routes below L284 pass this chain; health
  routes above do not.
- **Assumes:** Hono middleware ordering follows registration order; this is a
  framework contract external to repository source. Established by: pinned
  Hono dependency and its external implementation (`package.json:L62`).
- **Establishes:** A later operational handler only runs after a digest-based,
  timing-safe token comparison (`src/security/auth.ts:L1-L12`).
- **Depended on by:** Runtime/intents/settlements/events/outbox/metrics/replay and
  descriptor verification handlers.

```ts
// L294-L321
app.post("/v1/intents", async (context) => {
  /* content type, idempotency schema, body schema */
  const result = await dependencies.intents.createIdempotent(...);
  return context.json(publicIntent(result.intent), ...);
});
```

- **What:** Validates the untrusted request and requires an idempotency key
  before creating an intent.
- **Why here:** Schema checks precede cryptographic signing and database writes.
- **Assumes:** The authenticated caller is authorized to create any syntactically
  valid external reference/amount/expiry; there are no roles beneath the single
  API token. Established by: the sole Bearer gate at `L272-L282` and **nothing
  found** for a subordinate role model.
- **Establishes:** Invalid requests have no intended writes; successful calls
  return the stable payer handoff and indicate replay.
- **Depended on by:** Merchant integration and payer checkout.

```ts
// L432-L445
app.post("/v1/outbox/:eventId/replay", ...);
```

- **What:** Resets delivery state only when the selected event exists and is
  already dead-lettered.
- **Why here:** Authentication middleware has already run.
- **Assumes:** Any API-token holder may replay any dead letter; no finer-grained
  role model exists. Established by: the same `/v1/*` Bearer middleware and
  **nothing found** in this handler for a second authorization decision.
- **Establishes:** A live/delivered/nonexistent event is not rescheduled.
- **Depended on by:** Operational recovery of webhook delivery.

---

**Cross-Function Dependencies:**

- Callee `bearerTokenMatches` (internal): hashes supplied/expected tokens and
  timing-safe compares fixed-length digests (`src/security/auth.ts:L1-L12`).
- Callee `IntentService.createIdempotent` (internal): validates business fields,
  signs a descriptor, and atomically persists intent/idempotency.
- Callee database list/replay methods (internal): parameterized SQL and
  dead-letter predicate (`src/db/database.ts:L568-L652`).
- Callee Hono middleware/server (external-source-available dependency): route and
  middleware dispatch semantics.
- Caller: `PPOpsDaemon.start` constructs it once with runtime dependencies
  (`src/api/server.ts:L43-L73`); tests also call it directly.
- Shared state: in-memory rate-limit maps, health object, SQLite through service
  dependencies.

**Open Questions:**

- Intended reverse-proxy/source-IP semantics are not documented in this
  function; `getConnInfo` observes the direct connection.
- Whether public checkout status should remain accessible after expiry/payment
  is a product-policy question; this function returns any existing intent.
