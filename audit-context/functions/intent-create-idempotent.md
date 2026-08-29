## `IntentService.createIdempotent` / `createRecord` in `src/intents/service.ts` (L62-L160)

**Purpose:** Converts one authenticated merchant request into exactly one local
intent for a given idempotency key, with a random correlation reference and an
EIP-712 descriptor bound to the runtime profile.

**Inputs & Assumptions:**

- `input.externalReference`, `amountAtomic`, `expiresAt`: originally untrusted
  HTTP body values; API Zod validation precedes this call, and `createRecord`
  repeats business-level checks (`L93-L105`).
- `idempotencyKey`: originally an untrusted header; both API schema and this
  method enforce grammar/length (`L67-L69`).
- `now`: trusted process clock by default; test callers may inject it.
- Implicit: merchant private key, network/token profile, receiver 0zk address,
  random source, and SQLite connection supplied at construction (`L44-L50`).
  Established by: `PPOpsRuntime.create` wiring and the Node/SQLite dependencies.
- Precondition: database schema and projection pairing exist. Established by
  `PPOpsDatabase` migration and `insertIntent` (`src/db/database.ts:L156-L290`).

**Outputs & Effects:**

- Returns `{ intent, replayed }`.
- On first use, inserts payment intent, initial `OPEN` projection, and hashed
  idempotency mapping in one SQLite transaction.
- On identical reuse, returns the original intent without a new descriptor or
  reference.
- On same key/different normalized input, throws `IdempotencyConflictError`.
- The raw idempotency key is not stored; its SHA-256 digest is.

---

**Block-by-Block:**

```ts
// L67-L85
if (!/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) throw ...;
const fingerprint = fingerprintFor(input);
const storageKey = createHash("sha256").update(idempotencyKey).digest("hex");
const existing = this.database.getIntentIdempotency(storageKey);
...
```

- **What:** Canonicalizes the external reference by trimming inside the request
  fingerprint (`L30-L39`), hashes the idempotency key, and handles a fast replay.
- **Why here:** Avoids generating/persisting a new random descriptor when a
  completed mapping is already known.
- **Assumes:** SHA-256 equality is sufficient identity for keys/fingerprints;
  collision handling beyond equality is established by: **nothing found**.
- **Establishes:** A matching stored key/fingerprint maps to its original intent;
  a changed request is rejected.
- **Depended on by:** API replay status and merchant retry behavior.

```ts
// L93-L105
const externalReference = input.externalReference.trim();
/* length, positive uint256 amount, future safe timestamp */
```

- **What:** Applies service-level bounds before signing or writing.
- **Why here:** The service can also be called outside the HTTP route.
- **Assumes:** Process clock is the intended authority for expiry. Established
  by: the injected/default `now` value at `L91-L92`; external clock correctness
  is a host contract.
- **Establishes:** Stored amount is a positive decimal within `uint256`; expiry
  is a future safe-integer Unix timestamp at creation time.
- **Depended on by:** Descriptor encoding and projection arithmetic.

```ts
// L107-L120
const reference = `0x${randomBytes(32).toString("hex")}`;
const descriptor = await createSignedDescriptor(...);
verifySignedDescriptor(descriptor, this.merchantSigner);
```

- **What:** Generates an opaque 32-byte reference, signs all payer-relevant
  fields, and immediately checks the result against the derived merchant signer.
- **Why here:** No intent is persisted unless descriptor production verifies.
- **Assumes:** Node cryptographic randomness and ethers typed-data operations.
  Established by: calls at `L107-L120` and their pinned external implementations.
- **Establishes:** Descriptor authenticity relative to this runtime's merchant
  key, not payer knowledge of that signer.
- **Depended on by:** Public checkout and scanner reference matching.

```ts
// L122-L157
const record = { id: `pi_${randomUUID()...}`, ... };
const existingIntentId = this.database.transaction(() => {
  /* repeat idempotency lookup; insert intent and mapping */
});
```

- **What:** Builds the durable record and repeats the key lookup inside the
  transaction before inserts.
- **Why here:** The second check closes the same-process gap between the fast
  lookup and write; SQLite uniqueness also constrains duplicate keys/references.
- **Assumes:** All writes for this database run through the same SQLite locking
  semantics; the root runtime lock prevents a second normal process.
  Established by: `PPOpsDatabase.transaction` and `PPOpsRuntime.create`; for
  arbitrary direct database writers outside that lifecycle: **nothing found**.
- **Establishes:** Intent, projection, and idempotency mapping commit or roll back
  together.
- **Depended on by:** `requireView` at L158-L159 and every later reconciliation.

---

**Cross-Function Dependencies:**

- Callee `fingerprintFor` (internal, L30-L39): hashes trimmed reference, exact
  amount string, and expiry.
- Callee `createSignedDescriptor` / `verifySignedDescriptor` (internal): typed
  data construction and signer recovery (`src/security/descriptor.ts:L69-L111`).
- Callee `PPOpsDatabase.transaction`, `insertIntent`, and
  `insertIntentIdempotency` (internal): SQLite transaction and paired projection
  creation (`src/db/database.ts:L152-L153`, `L260-L305`).
- Callers: authenticated `POST /v1/intents` and tests. `IntentService.create`
  shares `createRecord` without an idempotency mapping for internal/test uses.
- Shared state: payment intents, intent projections, idempotency table.
- Invariant coupling: the descriptor's reference/profile must equal the fields
  stored in the intent; both are assembled from the same locals at L107-L136.

**Open Questions:**

- The intended production caller set for non-idempotent `create` is not
  expressed by module boundaries; the current HTTP product API does not use it.
