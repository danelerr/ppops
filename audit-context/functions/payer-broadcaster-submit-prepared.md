## `BroadcasterSession.submitPrepared` in `tools/ppops-payer/src/broadcaster/session.ts` (L480-L517)

**Purpose:** Crosses Gate B's Waku submission boundary after durable reservation,
admits only a transaction-hash-shaped success value, and reduces selected
decrypted Broadcaster response strings to project-owned rejection or ambiguity
categories.

**Inputs & Assumptions:**

- `prepared` (`PreparedBroadcasterSubmission`): `{ quote, send }` returned by
  `prepareSubmission`. Trust: internal capability; TypeScript shape alone does
  not establish provenance for direct JavaScript callers.
- Precondition: the caller has persisted either the initial Broadcaster
  reservation or a bounded retry attempt for the same request/payer/nullifier
  set. Established by the standard caller ordering at
  `tools/ppops-payer/src/railgun/broadcaster-transfer.ts:L337-L359`; this method
  does not inspect the journal.
- Precondition: the SDK's static response key still belongs to this prepared
  transaction. Normal CLI execution has one payer operation under
  `PayerRuntimeLock`; exclusion for arbitrary concurrent prepared sessions is
  established by: **nothing found** at this class boundary.
- Implicit: installed SDK retry/Store/Filter/nullifier behavior and the exact
  nested `Error` shape emitted for decrypted Broadcaster response errors.
  Project classification is established by exact string maps at
  `tools/ppops-payer/src/broadcaster/failures.ts:L39-L137`; a version-independent
  SDK error contract is established by: **nothing found** in project source.

**Outputs & Effects:**

- Invokes `prepared.send()` once in this call. The standard closure begins Waku
  submission and may retransmit the same encrypted request.
- Returns only a `0x` plus 64-hex-character string. Its SDK origin remains
  untagged: decrypted response and nullifier lookup both return the same type.
- Converts one recognized response family to `BroadcasterRejectedFailure`
  (`BROADCASTER_REJECTED` plus `rejectionCode`) and another to
  `BroadcasterAmbiguousResponseFailure` (`BROADCASTER_SUBMISSION_FAILED` plus
  `ambiguityCode`).
- Converts an invalid returned hash to
  `BroadcasterAmbiguousResponseFailure("INVALID_TRANSACTION_HASH")`; converts
  every otherwise unrecognized post-send error to
  `BroadcasterAmbiguousResponseFailure("UNCLASSIFIED_FAILURE")`. Both retain the
  top-level `BROADCASTER_SUBMISSION_FAILED` code.
- Does not mutate the journal or inspect a public receipt; the caller interprets
  the subclass and records the matching state.

---

**Block-by-Block:**

```ts
// L483-L490
const transactionHash = await prepared.send();
if (!/^0x[0-9a-fA-F]{64}$/.test(transactionHash)) {
  throw new BroadcasterAmbiguousResponseFailure("INVALID_TRANSACTION_HASH");
}
return transactionHash;
```

- **What:** Executes the prepared capability and constrains its success value.
- **Why here:** Shape validation precedes persistence as
  `reportedTransactionHash`.
- **Assumes:** `prepared.send` is the closure returned by this session's
  `prepareSubmission`. Standard caller dataflow establishes this; a runtime
  brand is established by: **nothing found**.
- **Assumes:** A hash-shaped return is diagnostic until project-side nullifier
  recovery. Established by the caller keeping reported and canonical hashes
  separate at
  `tools/ppops-payer/src/railgun/broadcaster-transfer.ts:L407-L448`.
- **Establishes:** Success yields one bounded hash string, not mining, receipt or
  canonical-identity evidence.
- **Depended on by:** `markBroadcasterReported` and immediate wallet sync.

```ts
// L491-L515
if (error is already a classified Broadcaster failure) throw error;
const rejectionCode = classifyDefinitiveBroadcasterRejection(error);
if (rejectionCode) throw new BroadcasterRejectedFailure(rejectionCode, { cause: error });
const ambiguityCode = classifyAmbiguousBroadcasterResponse(error);
if (ambiguityCode) {
  throw new BroadcasterAmbiguousResponseFailure(ambiguityCode, { cause: error });
}
throw new BroadcasterAmbiguousResponseFailure("UNCLASSIFIED_FAILURE", { cause: error });
```

- **What:** Applies the rejection map first, then the ambiguity map, then a
  stable unclassified-ambiguity fallback.
- **Why here:** The caller can durably distinguish an initial classified
  pre-submission rejection from a response that leaves chain completion
  unresolved, while final CLI JSON still exposes only the safe top-level code.
- **Assumes:** An SDK response error is represented as outer
  `"Received response error from broadcaster."` with an `Error` cause whose
  string exactly matches a pinned map entry. Established by the installed SDK at
  `tools/ppops-payer/node_modules/@railgun-community/waku-broadcaster-client-node/dist/transact/broadcaster-transaction.js:L136-L141` and the project maps at
  `tools/ppops-payer/src/broadcaster/failures.ts:L39-L137`.
- **Establishes:** Already classified errors preserve their category; recognized
  strings retain only stable project enum values; every otherwise unrecognized
  post-send error becomes the stable `UNCLASSIFIED_FAILURE` ambiguity.
- **Depended on by:** `sendBroadcasterTransfer`'s rejection/ambiguity journal
  branches.

---

**Cross-Function Dependencies:**

- Callee closure from `prepareSubmission` delegates to the installed SDK's
  `BroadcasterTransaction.send`
  (`tools/ppops-payer/src/broadcaster/session.ts:L445-L470`).
- Callee SDK `send/broadcast` LightPushes during the retry phase, queries Store,
  consumes a decrypted response or a nullifier-derived txid, and throws on local
  timeout
  (`tools/ppops-payer/node_modules/@railgun-community/waku-broadcaster-client-node/dist/transact/broadcaster-transaction.js:L69-L145`).
- Callees `classifyDefinitiveBroadcasterRejection` and
  `classifyAmbiguousBroadcasterResponse` inspect exact outer/cause strings; their
  category classes subclass `SafeFailure`
  (`tools/ppops-payer/src/broadcaster/failures.ts:L105-L165`).
- SDK response handling decrypts through one static key and stores one static
  response object without a local project schema
  (`tools/ppops-payer/node_modules/@railgun-community/waku-broadcaster-client-node/dist/transact/broadcaster-transact-response.js:L5-L44`).
- Caller `sendBroadcasterTransfer` reserves before calling, then records a
  classified rejection, ambiguity, or reported hash and separately seeks the
  canonical hash
  (`tools/ppops-payer/src/railgun/broadcaster-transfer.ts:L337-L448`).

**Open Questions:**

- Is the installed SDK's nested error-message vocabulary a versioned interface
  for the selected Broadcaster version range?
- Which mapped response strings prove that the selected Broadcaster did not
  submit the transaction, and where is that remote semantic contract defined?
- Does a resolved SDK hash identify whether it came from the decrypted response
  or the SDK's own nullifier lookup?
- When local SDK timeout throws `Request timed out.`, what lifecycle clears the
  static response key? The project classifies it as `WAKU_REQUEST_TIMEOUT`.
- Can `prepared.send` be invoked more than once, and does each call share the
  same static response lifecycle?
