## `WebhookDeliveryService.deliverPending` in `src/events/webhook.ts` (L93-L149)

**Purpose:** Delivers due outbox records to the single configured webhook with a
timestamped HMAC, then advances each record to delivered, retry, or dead-letter
state.

**Inputs & Assumptions:**

- `now`: time used to select due events and persist delivery state; defaults to
  process time.
- Constructor config: schema-validated URL, timeout, retry bounds, attempts, and
  optional key ID. Non-loopback HTTP is rejected by config
  (`src/config.ts:L144-L153`).
- Constructor HMAC key: validated 32-byte hex secret.
- `fetchImplementation`: external network function; injectable in tests.
- Precondition: only one delivery loop operates over this database. Daemon
  scheduling is serial, but exclusivity within this method is established by:
  **nothing found**.

**Outputs & Effects:**

- Attempts up to 25 due records in database order
  (`src/db/database.ts:L479-L499`).
- Sends the exact stored JSON with event ID, current timestamp, key ID, and
  HMAC headers; redirects are errors and each request has a timeout.
- Marks 2xx responses delivered; otherwise increments attempt and schedules
- Persists a bounded failure classification, not the raw network exception.
- Returns aggregate attempted/delivered/failed/dead-lettered counts.

---

**Block-by-Block:**

```ts
// L99-L104
const result = {...};
for (const record of this.database.listPendingEvents(now)) {
  result.attempted += 1;
  const timestamp = Math.floor(Date.now() / 1_000);
  const keyId = this.config.keyId ?? "v1";
```

- **What:** Snapshots currently due events and starts one delivery attempt each.
- **Why here:** Database ordering determines attempt order; signature time is
  fresh per network operation rather than the injected scheduling time.
- **Assumes:** Concurrent callers do not select the same unclaimed rows. No row
  lease/claim is created by `listPendingEvents`. Established for normal daemon
  flow by serial maintenance scheduling; for overlapping direct callers:
  **nothing found**.
- **Establishes:** Each loop iteration has fixed stored payload and fresh signing
  metadata.
- **Depended on by:** Receiver replay window and attempt state.

```ts
// L105-L125
const response = await fetch(url, {
  method: "POST", headers: { /* id, timestamp, keyId, HMAC */ },
  body: record.payloadJson,
  signal: AbortSignal.timeout(...), redirect: "error",
});
await response.body?.cancel();
if (!response.ok) throw ...;
```

- **What:** Sends and bounds one signed HTTP request.
- **Why here:** Delivery state changes only after response success is known.
- **Assumes:** Receiver interprets success HTTP as durable acceptance and
  deduplicates by event ID. Established by: **nothing found** in PPOps; receiver
  implementation is external in production.
- **Establishes:** A locally delivered record received a 2xx response for the
  exact stored payload/HMAC.
- **Depended on by:** `markEventDelivered`.

```ts
// L126-L145
database.markEventDelivered(...);
...
const failureCode = classifyWebhookFailure(error);
if (record.attempts + 1 >= maxAttempts) markEventDeadLettered(...failureCode)
else markEventFailed(...now + retrySeconds..., failureCode);
```

- **What:** Persists one mutually selected outcome, reducing failures to a
  fixed code before database storage.
- **Why here:** Network outcome precedes durable attempt transition.
- **Assumes:** A process stop between receiver acceptance and local marking may
  cause redelivery; receiver event-ID idempotency is required for exact effect.
  Established by: send-before-mark ordering at `L105-L126`; receiver idempotency
  is established by: **nothing found** in this function.
- **Establishes:** Local outbox eventually leaves the pending set on success or
  at maximum attempt count.
- **Depended on by:** Maintenance metrics and replay endpoint.

---

**Cross-Function Dependencies:**

- Callee `webhookSignature` (internal, L35-L44): HMAC-SHA256 over
  `timestamp.keyId.eventId.rawPayload`.
- Callee `classifyWebhookFailure` (internal, L14-L33): maps known timeout, HTTP,
  and network forms to a bounded code.
- Callee database pending/mark methods (internal): SQL predicates and attempt
  counters (`src/db/database.ts:L479-L526`).
- Caller `PPOpsRuntime.maintenanceOnce`, invoked before and after scans and on
  expiry maintenance (`src/runtime.ts:L93-L143`).
- External receiver/fetch/TLS are black boxes in this context pass.
- Shared state: outbox rows; webhook configuration/key.

**Open Questions:**

- Production receiver durability and event-ID deduplication contract are outside
  this repository.
- Clock synchronization expectations between sender and receiver are not
  enforced by the sender.
