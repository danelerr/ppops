## `SubmissionJournal` in `tools/ppops-payer/src/security/submission-journal.ts` (L19-L747)

**Purpose:** Maintains owner-only durable payer submission lineages. For Gate B
it stores the original request/payer/quote/fee/nullifier reservation, bounded
same-nullifier retry attempts, classified rejection/ambiguity outcomes, a
Waku-reported hash, the independently recovered canonical hash and receipt state.

**Inputs & Assumptions:**

- `path`: deterministic `${walletStatePath}.submissions.json` derived from
  validated payer configuration at L286-L287. Constructor provenance checking is
  established by callers, not this class.
- `PaymentRequest`: expected to be signature-verified and unchanged. The durable
  fingerprint includes only domain, intent ID and descriptor signature
  (L260-L266).
- Initial Gate B inputs: payer/Broadcaster 0zk addresses, quote fingerprint, raw
  fee ID, positive fee amount and populated nullifiers.
- Retry inputs: the same request/payer and exact nullifier set, with current
  Broadcaster/quote/fee metadata.
- Outcome inputs: project enums from `broadcaster/failures.ts`, reported or
  canonical transaction hashes, and configured-provider receipt block/status.
- Implicit: Unix seconds, local account/filesystem integrity, rename/fsync
  semantics and serialized mutation.
- Precondition: callers do not overlap read-modify-write operations. Normal
  submit/retry calls run under `PayerRuntimeLock`, while recovery writes occur
  after its engine wrapper returns. An internal journal lock for direct or
  recovery callers is established by: **nothing found**.
- Precondition: the journal is changed only through these methods. Owner-only
  file checks establish local file properties; exclusive method provenance is
  established by: **nothing found**.

**Outputs & Effects:**

- `get` returns the first strict record for an intent; `assertUnused` rejects any
  existing lineage.
- Initial Gate B reserve normalizes/sorts nullifiers and refuses overlap with
  another Broadcaster record unless that record is `REJECTED` or `REVERTED`.
- Retry admission/reservation requires the same request fingerprint, payer and
  exact nullifier set, no canonical/reported hash, `SUBMITTING`, and fewer than
  three existing retry attempts.
- Base states are `SUBMITTING`, `SUBMITTED`, `MINED`, `REVERTED`, `REJECTED`.
  Canonical flow is `SUBMITTING -> SUBMITTED -> MINED|REVERTED`; fresh classified
  rejection is `SUBMITTING -> REJECTED`.
- Retry-attempt outcomes are `RESERVED`, `REJECTED`, `AMBIGUOUS`, `REPORTED`;
  retry rejection/ambiguity does not change the base `SUBMITTING` state.
- Up to four distinct ambiguity categories are stored on the base record,
  including `UNCLASSIFIED_FAILURE`; raw SDK error text and raw Broadcaster fee
  IDs are not stored.
- Every mutation parses the whole journal, writes a fresh mode-0600 temporary
  file, syncs it, renames it and syncs the directory on non-Windows systems.

---

**Block-by-Block:**

```ts
// L19-L68
const BroadcasterRetryAttemptSchema = z.object({
  broadcaster identity, quote/feesID fingerprints, fee,
  outcome: RESERVED | REJECTED | AMBIGUOUS | REPORTED,
  rejectionCode?, ambiguityCode?, timestamps,
}).strict().superRefine(outcome-specific code presence);
```

- **What:** Defines bounded retry-attempt identity and outcome grammar.
- **Why here:** Each retry retains the quote/fee context used with the original
  nullifiers without storing raw fee ID or SDK error text.
- **Assumes:** These four outcomes fully describe operator-relevant retry state.
  Established by Gate B callers using only the matching transition methods;
  remote protocol completeness is established by: **nothing found**.
- **Establishes:** Rejected/ambiguous attempts carry exactly their corresponding
  stable category; other outcomes carry neither category.
- **Depended on by:** Whole-record schema and retry transition methods.

```ts
// L70-L246
const SubmissionRecordSchema = z.object({
  mode-specific identity, retryAttempts(max 3), ambiguityCodes(max 4),
  reportedHash?, rejectionCode?,
  status: SUBMITTING | SUBMITTED | MINED | REVERTED | REJECTED,
  canonicalHash?, blockNumber?, ...
}).strict().superRefine(...);
```

- **What:** Defines Gate A/Gate B field separation and couples status to
  hash/block/rejection fields.
- **Why here:** Every read/write validates complete state independently of the
  method that produced it.
- **Assumes:** Missing `submissionMode` denotes a legacy self-signed record.
  Established by the explicit `?? "SELF_SIGNED"` at L108; provenance of legacy
  state is established by: **nothing found** beyond private-file policy.
- **Assumes:** A `REJECTED` Broadcaster record needs no canonical/reported hash or
  block; this is established as project state grammar at L204-L223. The remote
  non-submission meaning is established by: **nothing found** in this schema.
- **Establishes:** Gate B always has payer/Broadcaster/quote/fee/nullifiers and no
  self-signer/nonce; nullifiers are one to 64 nonzero unique hashes;
  `SUBMITTED|MINED|REVERTED` require canonical hash; only receipt-terminal states
  have block; `REJECTED` requires a rejection category and no hashes/block.
- **Depended on by:** Every journal read, transition and CLI state consumer.

```ts
// L248-L287
SubmissionJournalSchema = { schemaVersion: 1, records: max 10_000 };
requestFingerprint = sha256(domain + intentId + descriptor.signature);
feesIDFingerprint = sha256(domain + raw feesID);
normalizedNullifiers = lowercase + sort;
sameNullifierSet = normalized exact array equality;
```

- **What:** Defines whole-file cap and domain-separated correlation helpers.
- **Why here:** Later retries compare request/nullifier identity without storing
  the complete request or raw fee ID.
- **Assumes:** Digest equality is sufficient correlation identity. Special
  collision handling is established by: **nothing found**.
- **Establishes:** Deterministic request/fee fingerprints and order-insensitive
  exact nullifier-set comparison.
- **Depended on by:** Initial reservation, retry admission/reservation and schema
  persistence.

```ts
// L292-L332
get(intentId) -> first record;
assertUnused -> reject any record;
assertBroadcasterRetryable -> require BROADCASTER/SUBMITTING,
  no canonical/reported hash, same request fingerprint/payer, retries < 3;
```

- **What:** Provides initial and retry preflight snapshots.
- **Why here:** Expensive proof work starts only for an eligible lineage.
- **Assumes:** At most one record has an intent ID. Reservation methods recheck
  under serialized use; whole-file schema-level intent uniqueness is established
  by: **nothing found**.
- **Assumes:** Hashless `SUBMITTING` plus count/request/payer is enough retry
  eligibility; presence of a prior ambiguity category is not required by this
  method. Established by the explicit predicate at L310-L330.
- **Establishes:** Successful initial preflight saw no record; successful retry
  preflight saw the exact unresolved lineage and available retry slot.
- **Depended on by:** `sendBroadcasterTransfer` before proof generation.

```ts
// L334-L410
reserve(...) -> SELF_SIGNED/SUBMITTING with precomputed hash;
reserveBroadcaster(...) {
  reject same intent;
  reject nullifier overlap with BROADCASTER records except REJECTED/REVERTED;
  append BROADCASTER/SUBMITTING with normalized nullifiers and quote/fee identity;
}
```

- **What:** Creates the initial durable lineage before the irreversible send.
- **Why here:** Gate B recovery identity exists even if Waku later yields no
  usable response.
- **Assumes:** Excluding `REJECTED` and `REVERTED` from collision ownership makes
  their notes eligible for another intent. The implemented policy is established
  at L381-L394; its RAILGUN note-spend semantics are established by: **nothing
  found** in this class.
- **Assumes:** The supplied nullifiers belong to the prepared proxy calldata.
  Standard caller dataflow establishes this at
  `tools/ppops-payer/src/railgun/broadcaster-transfer.ts:L324-L350`; direct caller
  binding is established by: **nothing found**.
- **Establishes:** New active Gate B records cannot overlap a nullifier already
  held by another local Broadcaster record in `SUBMITTING`, `SUBMITTED` or
  `MINED`; successful record starts hashless in `SUBMITTING`.
- **Depended on by:** Initial `submitPrepared` and later recovery.

```ts
// L412-L468
reserveBroadcasterRetry(request, input) {
  require same unresolved BROADCASTER record;
  require same request fingerprint, payer and exact nullifier set;
  require attempts < 3;
  append current Broadcaster/quote/feesID fingerprint/fee as RESERVED;
}
```

- **What:** Adds one bounded retry attempt to the existing lineage.
- **Why here:** Retry may refresh Broadcaster/fee metadata but cannot change the
  recovery nullifiers, payer or signed request.
- **Assumes:** A newly prepared transaction with the same nullifiers represents a
  retry of the same spend lineage. Exact equality is established here;
  remote/protocol idempotence is established by: **nothing found**.
- **Assumes:** The retry uses a Broadcaster identity not already attempted in the
  lineage. The standard caller constructs and applies that exclusion before
  proof generation
  (`tools/ppops-payer/src/railgun/broadcaster-transfer.ts:L138-L178` and
  `tools/ppops-payer/src/broadcaster/session.ts:L196-L260`); this journal method
  itself establishes distinct-address enforcement for direct callers by:
  **nothing found**.
- **Establishes:** At most three retry records; successful call leaves the base
  state `SUBMITTING` and adds one `RESERVED` attempt.
- **Depended on by:** Retry `submitPrepared` and its outcome methods.

```ts
// L470-L542
markRejected -> only fresh hashless SUBMITTING with zero retries;
  base status = REJECTED + rejectionCode;
markBroadcasterRetryRejected -> find latest matching RESERVED quote attempt;
  attempt outcome = REJECTED + rejectionCode; base remains SUBMITTING;
```

- **What:** Separates a classified fresh terminal rejection from a rejected
  retry attempt.
- **Why here:** A prior ambiguous lineage remains unresolved even if a later
  retransmission receives a rejection response.
- **Assumes:** The project response classifier correctly distinguishes these
  categories. Stable enum/string matching is established in
  `tools/ppops-payer/src/broadcaster/failures.ts:L39-L165`; remote semantics are
  established by: **nothing found** in this class.
- **Establishes:** Fresh rejection is terminal/hashless for that intent; retry
  rejection consumes one attempt but preserves original `SUBMITTING` recovery.
- **Depended on by:** Recovery/fresh-intent output and retry counting.

```ts
// L544-L598
markBroadcasterAmbiguous(intentId, code, retryQuoteFingerprint?) {
  require hashless BROADCASTER/SUBMITTING;
  for retry, match latest RESERVED quote attempt and mark AMBIGUOUS;
  for initial, require no retry attempts;
  append code to deduplicated base ambiguity list;
}
```

- **What:** Records stable unresolved-response evidence for initial or retry send.
- **Why here:** Chain completion remains a nullifier-recovery question rather
  than a new base terminal state.
- **Assumes:** Quote fingerprint identifies the intended retry attempt when
  several attempts exist. Established by latest matching `RESERVED` selection at
  L565-L583; uniqueness of quote fingerprints across attempts is established by:
  **nothing found**.
- **Establishes:** Matching retry becomes `AMBIGUOUS`; base stays `SUBMITTING` and
  stores each category once, subject to the schema maximum of four.
- **Depended on by:** Status output, recovery and later retry admission.

```ts
// L600-L648
markBroadcasterReported(intentId, hash) {
  require BROADCASTER/SUBMITTING;
  normalize hash; reject different prior hash; same prior hash returns;
  mark latest RESERVED retry REPORTED when present;
  store reportedTransactionHash; keep base SUBMITTING;
}
```

- **What:** Stores the SDK-returned hash as diagnostic metadata and closes the
  active retry-attempt outcome when one exists.
- **Why here:** Reported hash is kept distinct from nullifier-derived canonical
  identity.
- **Assumes:** Latest `RESERVED` attempt is the call that returned the hash.
  Standard sequential caller ordering establishes this; concurrent writers are
  established by: **nothing found**.
- **Establishes:** At most one reported hash per lineage; same hash is idempotent;
  base remains `SUBMITTING` until `markSubmitted`.
- **Depended on by:** Status/recovery evidence and immediate canonical lookup.

```ts
// L650-L702
markMined -> require canonical hash and SUBMITTED;
  write MINED|REVERTED + block; exact terminal repeat returns;
markSubmitted -> reject different existing hash;
  SUBMITTED returns; otherwise require SUBMITTING and write canonical hash;
```

- **What:** Applies canonical and receipt-observed forward transitions shared by
  Gate A and Gate B.
- **Why here:** Public receipt state cannot exist before canonical identity.
- **Assumes:** Gate B canonical hash came from this record's complete nullifiers
  and receipt inputs came from configured-provider quorum. Established by
  `sendBroadcasterTransfer`/`recoverBroadcaster`; direct method callers are
  established by: **nothing found**.
- **Establishes:** Existing canonical hash cannot change; canonical transition is
  `SUBMITTING -> SUBMITTED`; receipt transition is
  `SUBMITTED -> MINED|REVERTED`, with exact repeat idempotence.
- **Depended on by:** Receipt lookup, `submission-status` and PPOI finalization.

```ts
// L704-L747
readOwnerOnlyFile(max 2 MiB) -> JSON + strict schema; ENOENT -> empty;
write -> strict parse; mkdir 0700; temp open wx 0600; write+fsync;
  rename; directory fsync on non-Windows; cleanup temp on error;
```

- **What:** Reads identity-stable private state and performs synchronized
  whole-document replacement.
- **Why here:** Public methods never act on partial or non-schema state.
- **Assumes:** Host rename/fsync provides the expected durability contract.
  Equivalent explicit Windows directory sync is established by: **nothing
  found**.
- **Establishes:** Successful read is strict; successful mutation returns after
  file sync, rename and non-Windows directory sync. Missing file means empty
  journal.
- **Depended on by:** Every public journal method.

---

**Cross-Function Dependencies:**

- `readOwnerOnlyFile` enforces regular-file, no-symlink, size, ownership/mode and
  before/after identity checks
  (`tools/ppops-payer/src/security/private-file.ts:L9-L58`).
- `sendBroadcasterTransfer` selects initial/retry reservation and records
  classified response/reported/canonical/receipt outcomes
  (`tools/ppops-payer/src/railgun/broadcaster-transfer.ts:L120-L496`).
- `recoverBroadcaster` reads terminal/pending state and may invoke
  `markSubmitted/markMined`
  (`tools/ppops-payer/src/cli.ts:L907-L1035`).
- `submissionStatus` reports base state, retry count, rejection/ambiguity codes
  and reported/canonical/block fields without wallet startup
  (`tools/ppops-payer/src/cli.ts:L564-L613`).
- `finalizePOI` requires `MINED` and canonical hash
  (`tools/ppops-payer/src/cli.ts:L615-L653`).
- `broadcaster/failures.ts` owns the category enums used by schema/outcome methods
  (`tools/ppops-payer/src/broadcaster/failures.ts:L3-L35`).

**Open Questions:**

- What protocol property makes nullifiers from `REJECTED` and `REVERTED` records
  available to a different intent while those records remain durable?
- Is schema-level uniqueness for intent IDs and active nullifier ownership an
  intended file invariant, or is exclusive mutation through these methods the
  complete trust assumption?
- What serialization rule covers recovery writes outside `PayerRuntimeLock` and
  arbitrary direct journal callers?
- Is retry eligibility intentionally independent of whether an ambiguity code
  was recorded on the initial/previous attempt?
- What operator semantics apply when more than four distinct ambiguity
  categories would be observed across one lineage?
- Is the journal independently backed up, or is preserving this adjacent file an
  operational prerequisite for recovery?
