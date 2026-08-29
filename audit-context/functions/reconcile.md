## `ReconciliationService.reconcile` in `src/reconciliation/service.ts` (L44-L92)

**Purpose:** Atomically converts a normalized observation into durable settlement
state, matches it to a local intent, rebuilds that intent's projection, and
queues transition events.

**Inputs & Assumptions:**

- `candidate`: semi-trusted internal input from `RailgunScanner`; it contains
  SDK/RPC-derived identity, amount, reference, chain status, and PPOI status.
- `now`: process time by default.
- Implicit: SQLite intent/settlement/projection/outbox state. Established by:
  the injected `PPOpsDatabase` and its migrated schema.
- Precondition: positive decimal amount, strict reference, normalized hash/token,
  and valid enum states. Established by scanner for product callers; direct
  callers are not runtime-validated here. The database constrains enum values,
  but numeric-string shape is established by: **nothing found** in this method.

**Outputs & Effects:**

- Returns the stored settlement record.
- Inserts or updates a settlement under `uniqueSettlementId`.
- Assigns `UNMATCHED`, `MATCHED`, or `CONFLICT` from reference plus chain/token.
- May preserve historical `SPENDABLE` when a previously spendable note appears
  as SDK `Spent` with `UNKNOWN` PPOI.
- For a matched intent, inserts one initial observation event and rebuilds the
  projection/event transition in the same SQLite transaction.
- Throws and rolls back if immutable identity fields change.

---

**Block-by-Block:**

```ts
// L46-L48
return this.database.transaction(() => {
  const existing = this.database.getSettlement(candidate.uniqueSettlementId);
  if (existing) this.assertImmutableIdentity(existing, candidate);
```

- **What:** Starts a synchronous SQLite transaction and verifies rediscovered
  identity before any update.
- **Why here:** A collision cannot partially mutate settlement/projection/outbox.
- **Assumes:** The immutable field set at `L12-L21` contains every identity/value
  attribute that must never change; block/finality/PPOI/railgunTxid are allowed
  to evolve. Established by: the explicit comparison list; a broader protocol
  completeness proof is established by: **nothing found**.
- **Establishes:** An existing ID retains chain/version/coordinates/hash/token/
  amount/reference identity or the entire operation aborts.
- **Depended on by:** Upsert idempotency and exact-on-restart behavior.

```ts
// L50-L57
const intent = candidate.reference ? database.findIntentByReference(...) : undefined;
const matchesRail = intent !== undefined && intent.chainId === candidate.chainId &&
  intent.tokenAddress.toLowerCase() === candidate.tokenAddress.toLowerCase();
const matchStatus = intent ? (matchesRail ? "MATCHED" : "CONFLICT") : "UNMATCHED";
```

- **What:** Resolves only the opaque reference, then separately requires chain
  and token equality.
- **Why here:** An existing reference on another rail/profile is recorded but
  not credited.
- **Assumes:** The receiver-wallet context is implicit because the scanner only
  scans this instance's loaded wallet; no recipient field exists in settlement.
  Established for product callers by `PPOpsRuntime` scanner wiring; for direct
  callers: **nothing found**.
- **Establishes:** Only local reference plus chain/token yields `MATCHED`.
- **Depended on by:** `deriveProjection` credit/pending filters.

```ts
// L58-L76
const poiStatus = candidate.balanceBucket === "Spent" &&
  candidate.poiStatus === "UNKNOWN" && existing?.poiStatus === "SPENDABLE"
  ? "SPENDABLE" : candidate.poiStatus;
const eligible = matchStatus === "MATCHED" &&
  candidate.chainStatus === "FINALIZED" && poiStatus === "SPENDABLE";
const settlement = database.upsertSettlement({...});
```

- **What:** Applies the historical spent-state rule, computes first eligibility,
  and upserts mutable state/timestamps.
- **Why here:** A spent note may no longer expose current raw proof status; prior
  spendability is retained only under the exact transition.
- **Assumes:** `Spent + prior SPENDABLE` remains historically creditable. The
  protocol-level guarantee is established by: **nothing found in project
  source**.
- **Establishes:** `eligibleAt` records the first locally observed eligible time
  and is preserved by DB `COALESCE` (`src/db/database.ts:L379-L415`).
- **Depended on by:** Recheck window and intent received amount.

```ts
// L78-L90
if (!intent || !matchesRail) return settlement;
if (!existing) persistEvent("settlement.observed", ...);
this.rebuildProjection(intent, now, settlement.uniqueSettlementId);
return settlement;
```

- **What:** Stops unmatched/conflicting candidates after storage; matched notes
  emit first-observed once and derive any payment transition.
- **Why here:** Commercial state and events are only attached to an exact match.
- **Assumes:** `existing` by ID is sufficient to decide whether observation was
  previously emitted. Established by: the settlement primary key, deterministic
  identity, and enclosing database transaction.
- **Establishes:** Settlement, projection revision, and outbox inserts are one
  commit.
- **Depended on by:** Webhook correctness and restart idempotency.

---

**Cross-Function Dependencies:**

- Callee `PPOpsDatabase.transaction/upsertSettlement/insertEvent` (internal):
  synchronous atomicity, primary/unique constraints, durable outbox.
- Callee `deriveProjection` through `rebuildProjection` (internal): recomputes
  all value/status from settlements (`L106-L125`).
- Callee `createEvent` (internal): deterministic event ID from dedupe key.
- Callers: initial scan candidates and persisted-chain rechecks in
  `PPOpsRuntime.scanOnce` (`src/runtime.ts:L93-L126`). Tests call directly.
- Shared state: settlements, intent projection, outbox.
- Invariant coupling: `upsertSettlement` can update match/reference/intent fields,
  but the preceding immutable check prevents reference/value/token identity drift
  for an existing ID.

**Open Questions:**

- Protocol rationale for retaining prior spendability after the SDK reports
  `Spent/UNKNOWN` should remain tied to the pinned SDK version semantics.
- Direct library callers can supply a candidate bypassing scanner normalization;
  whether this API is intended to be public is not documented.
