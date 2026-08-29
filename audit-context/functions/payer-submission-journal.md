## `SubmissionJournal` in `tools/ppops-payer/src/security/submission-journal.ts` (L12-L148)

**Purpose:** Maintains one durable local payer record per PPOps intent so the
self-signed path can reserve an attempt before its irreversible network call and
associate a returned transaction hash afterward.

**Inputs & Assumptions:**

- Journal path: derived from the validated payer wallet-state path.
- `PaymentRequest`: already strictly parsed and signature-verified by the payer.
- `selfSigner`: derived from the locally loaded EVM private key.
- Process time: integer Unix seconds supplied by default.
- Precondition: normal callers hold the payer runtime lock. The class does not
  acquire it internally; participation by arbitrary direct callers is
  established by: **nothing found**.

**Outputs & Effects:**

- Reads a strict, owner-only JSON document of at most 2 MiB, or treats `ENOENT`
  as an empty version-1 journal.
- Refuses reuse of an intent ID already present in any journal state.
- Appends a `SUBMITTING` record before send and changes that exact record to
  `SUBMITTED` with a transaction hash after ethers returns.
- Writes through a newly created mode-0600 temporary file, syncs it, then
  renames it over the journal path and, on non-Windows systems, syncs the
  containing directory.

---

**Block-by-Block:**

```ts
// L12-L42
const SubmissionRecordSchema = z.object({
  intentId, requestFingerprint, selfSigner,
  status: z.enum(["SUBMITTING", "SUBMITTED"]),
  createdAt, updatedAt, transactionHash: optionalHash,
}).strict();
const requestFingerprint = sha256("ppops-payer-request:v1:" + id + ":" + signature);
```

- **What:** Defines strict durable grammar and a domain-separated request
  fingerprint from intent ID and descriptor signature.
- **Why here:** Every later read/write is schema-normalized before use.
- **Assumes:** Intent ID plus signed descriptor signature identifies the payer
  snapshot that matters for local attempt tracking. Established by: the
  domain-separated hash construction at `L36-L42` and prior descriptor
  verification by the caller.
- **Establishes:** Parsed records contain bounded known fields and valid ID/hash
  formats.
- **Depended on by:** Duplicate check, reservation, status query, and hash update.

```ts
// L50-L60
async get(intentId) { return (await this.read()).records.find(...); }
async assertUnused(intentId) { if (await this.get(intentId)) throw ...; }
```

- **What:** Looks up by intent ID and maps any existing state to a fixed safe
  failure.
- **Why here:** Proof generation is avoided when the payer already knows of an
  attempt.
- **Assumes:** Normal caller serialization keeps the check meaningful through
  the later reservation. Established by: `withEngine` holding
  `PayerRuntimeLock`; direct callers are covered by: **nothing found**.
- **Establishes:** At return time, no matching record exists in the loaded file.
- **Depended on by:** `sendSelfSignedTransfer` before balance/proof work.

```ts
// L63-L84
const journal = await this.read();
if (journal.records.some(record => record.intentId === request.id)) throw ...;
journal.records.push({ ..., status: "SUBMITTING", ... });
await this.write(journal);
```

- **What:** Rechecks uniqueness, fingerprints the request, and durably appends a
  pre-submission reservation.
- **Why here:** This call occurs immediately before the external network send.
- **Assumes:** The caller treats a persisted `SUBMITTING` record as an ambiguous
  attempt rather than permission to retry automatically. Established by:
  `assertUnused`/`reserve` rejecting every existing state at `L54-L83`.
- **Establishes:** A valid journal record exists for the intent before `reserve`
  returns.
- **Depended on by:** The EVM submission call.

```ts
// L86-L102
const index = journal.records.findIndex(record => record.intentId === intentId);
if (!current) throw new Error(...);
journal.records[index] = { ...current, status: "SUBMITTED",
  transactionHash, updatedAt: now };
await this.write(journal);
```

- **What:** Requires the reservation to remain present and records the returned
  transaction hash.
- **Why here:** It preserves the original fingerprint/signer/timestamps while
  advancing only status/hash/update time.
- **Assumes:** The supplied hash belongs to the transaction for this reservation;
  that association is provided by the caller. Established by:
  `sendSelfSignedTransfer` passing the immediately returned ethers hash at
  `tools/ppops-payer/src/railgun/self-signed-transfer.ts:L241-L250`.
- **Establishes:** On return, the loaded journal can associate the intent with a
  submitted transaction hash.
- **Depended on by:** Later operator status/reconciliation.

```ts
// L104-L147
readOwnerOnlyFile(path, { maxBytes: 2 MiB });
SubmissionJournalSchema.parse(JSON.parse(...));
const temporaryPath = `${path}.tmp-${randomUUID()}`;
open(temporaryPath, "wx", 0o600); write; sync; close; rename;
if (process.platform !== "win32") open(directory); sync; close;
```

- **What:** Applies the common private-file policy to reads and uses a fresh,
  synchronized temporary file for whole-document replacement.
- **Why here:** Callers observe only schema-valid complete journal snapshots.
- **Assumes:** Filesystem rename/durability and directory integrity follow the
  host filesystem contract. On Windows, an explicit equivalent to the
  non-Windows directory fsync is established by: **nothing found**.
- **Establishes:** A successful write replaces the journal with strict JSON and
  removes its own temporary file on a caught failure when possible; non-Windows
  success includes a completed directory sync.
- **Depended on by:** All public journal methods.

---

**Cross-Function Dependencies:**

- Callee `readOwnerOnlyFile` enforces regular/no-symlink/owner/mode/size and
  before/after file identity (`tools/ppops-payer/src/security/private-file.ts:L9-L58`).
- Caller `sendSelfSignedTransfer` checks unused state before proof, reserves
  immediately before send, and marks the returned hash
  (`tools/ppops-payer/src/railgun/self-signed-transfer.ts:L104-L107`,
  `L241-L250`).
- Normal caller `withEngine` holds `PayerRuntimeLock` across all of those calls
  (`tools/ppops-payer/src/cli.ts:L339-L362`).
- Reader `submissionStatus` exposes only intent ID, journal state, and optional
  transaction hash (`tools/ppops-payer/src/cli.ts:L314-L337`).
- Shared state: one JSON journal adjacent to payer wallet state.

**Open Questions:**

- What evidence and procedure let an operator resolve a durable `SUBMITTING`
  record after an ambiguous RPC result or local mark/write failure?
- Is the mnemonic plus wallet creation block expected to recover the journal,
  or is this file an independently backed-up operational artifact?
