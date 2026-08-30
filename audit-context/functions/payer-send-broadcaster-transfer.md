## `sendBroadcasterTransfer` in `tools/ppops-payer/src/railgun/broadcaster-transfer.ts` (L123-L519)

**Purpose:** Implements Gate B from a verified request and synchronized full
payer wallet through bounded proof construction, initial or same-nullifier retry
reservation, Waku submission, classified outcome journaling, canonical hash
recovery and receipt-quorum state.

**Inputs & Assumptions:**

- `config`: owner-only Arbitrum/native-USDC payer profile with storage paths and
  configured RPC providers.
- `engine`: started full RAILGUN payer wallet. Its address is compared with the
  independent CLI expectation before this call
  (`tools/ppops-payer/src/cli.ts:L831-L836`).
- `session`: started `BroadcasterSession` configured from an owner-only trust
  file; its fee cache and Waku client are external network state.
- `request`: strict, live, signature-verified payment request bound to the
  independently supplied merchant signer. The CLI also enforces amount ceiling
  and exact intent confirmation before this call
  (`tools/ppops-payer/src/cli.ts:L808-L824`).
- `dbEncryptionKey`: full-wallet database key used by Wallet SDK estimation and
  proof generation; it is not included in the project-constructed Waku inputs.
- `maxBroadcasterFeeAtomic`: operator ceiling parsed as positive `uint256`.
- `submit`: false for proof-only preparation and true for the Waku branch.
- `retryAmbiguous`: false/absent for an initial lineage, true for the dedicated
  retry command. The name is operator-facing; eligibility is established by
  current journal state at L138-L154 and L337-L355.
- Implicit: Wallet SDK proof/population semantics, Waku/Broadcaster behavior,
  system clock, configured RPC majority and serialized CLI use under
  `PayerRuntimeLock` (`tools/ppops-payer/src/cli.ts:L831-L857`).
- Precondition: no other holder of the same mnemonic consumes the selected notes
  during proof/submission. Same-process CLI serialization is established by the
  runtime lock; cross-host exclusivity is established by: **nothing found**.

**Outputs & Effects:**

- Prepare mode returns bounded fee/gas/quote plus final-calldata simulation
  evidence and `NOT_SUBMITTED`; it creates neither SDK Waku transaction nor
  submission-journal record.
- Initial submit creates one `BROADCASTER/SUBMITTING` record. Retry submit adds
  one of at most three retry-attempt records while preserving exact request,
  payer and nullifier set.
- A classified fresh rejection advances the record to hashless `REJECTED`; a
  classified retry rejection marks that retry attempt `REJECTED` while the base
  record stays `SUBMITTING`.
- A classified ambiguous response records a stable ambiguity code and, for a
  retry, marks the matching attempt `AMBIGUOUS`; every unrecognized failure after
  `send()` starts uses `UNCLASSIFIED_FAILURE` and follows the same branch.
- A returned SDK hash is persisted as reported metadata. Only Wallet/Engine
  lookup from all nullifiers may establish the canonical hash and advance to
  `SUBMITTED`.
- Receipt quorum advances `SUBMITTED` to `MINED` or `REVERTED`; no receipt or no
  canonical hash returns `PENDING`.

---

**Block-by-Block:**

```ts
// L132-L154
const feeLimit = parseBroadcasterFeeLimit(...);
const submissionJournal = new SubmissionJournal(...);
if (retryAmbiguous) {
  require submit;
  await submissionJournal.assertBroadcasterRetryable(request, engine.railgunAddress);
} else {
  await submissionJournal.assertUnused(request.id);
}
```

- **What:** Creates the durable-state handle and selects initial or retry
  admission before expensive wallet work.
- **Why here:** An existing lineage prevents a second initial submission; retry
  requires an unresolved hashless Broadcaster record with matching request and
  payer and fewer than three prior retry attempts.
- **Assumes:** The journal snapshot remains applicable until the later reserve
  recheck. CLI runtime locking establishes normal-process serialization;
  journal-internal serialization for arbitrary callers is established by:
  **nothing found**.
- **Establishes:** The operation is eligible on the first journal snapshot and
  has a positive bounded fee ceiling.
- **Depended on by:** Balance, proof and later initial/retry reservation.

```ts
// L156-L244
require spendable >= amount;
require Arbitrum Type1 gas;
const { gasPrice, providerAgreement } = await readConservativeLegacyGasPrice(config);
const excluded = retryRecord ? [initial and prior retry Broadcaster addresses] : [];
const selected = await session.discover(excluded);
gasEstimate = await gasEstimateForUnprovenTransfer(...selected fee...);
broadcasterFee = calculateBroadcasterFeeERC20Amount(...);
assert fee token, fee limit, and spendable >= amount + fee;
```

- **What:** Fixes gas, selected fee quote, token fee and current spendable
  bounds before generating a proof. Retry discovery excludes the initial and all
  prior retry Broadcaster identities.
- **Why here:** Payment and fee are both encoded into the private transfer.
- **Assumes:** Wallet SDK estimation and fee calculation share the gas semantics
  later used by proof/population/Broadcaster. Passing the same gas/fee inputs
  establishes project-side consistency; internal SDK semantics are established
  by: **nothing found in project source**.
- **Assumes:** Discovered quotes are authorized by the pinned fee-signer policy.
  Established by `BroadcasterSession` validation and the installed fee handler at
  `tools/ppops-payer/node_modules/@railgun-community/waku-broadcaster-client-node/dist/fees/handle-fees-message.js:L32-L128`.
- **Assumes:** Switching to a not-yet-attempted Broadcaster is the intended retry
  diversity rule. Standard selection/exclusion is established by L170-L178 and
  `tools/ppops-payer/src/broadcaster/session.ts:L196-L260`; its remote liveness
  meaning is established by: **nothing found**.
- **Establishes:** Positive gas estimate, native-USDC fee within the explicit
  ceiling, and current spendable balance covering payment plus fee.
- **Depended on by:** Proof and quote-compatibility checks.

```ts
// post-proof/population boundary
await generateTransferProof(...payment, memo, broadcaster fee, gas...);
const populated = await populateProvedTransfer(...same inputs...);
const transaction = assertPopulatedPrivateTransfer(...configured proxy...);
const nullifiers = assertPopulatedNullifiers(populated.nullifiers);
await submissionJournal.assertBroadcasterNullifiersAvailable(request.id, nullifiers);
const finalSimulation = await simulatePopulatedTransferQuorum(config, transaction);
await revalidateLiveRequest(request, requestSource, expectedMerchantSigner);
const current = session.assertQuoteStillCurrent(selected);
```

- **What:** Generates/populates the private transfer, validates its visible
  proxy/nullifier output, rejects inputs held by another active local intent,
  quorum-simulates the exact final calldata, refetches the exact signed request
  and refreshes quote compatibility.
- **Why here:** Only a still-live request and admitted, RPC-executable populated
  result can reach Waku preparation or durable state. Simulation occurs before
  the final request/quote freshness checks so those checks remain closest to
  submission.
- **Assumes:** Wallet SDK binds memo, token, amount, recipient, fee, gas, PPOI and
  nullifiers into one proof. Established locally by repeated equal arguments and
  common population output; the cryptographic guarantee is established by:
  **nothing found in project source**.
- **Establishes:** Configured proxy/zero-value calldata, one to 64 unique nonzero
  nullifiers not reserved by another active local intent, a positive exact-call
  gas estimate from a strict configured-RPC majority, unchanged request and a
  live compatible quote. The mutation-time reserve repeats the conflict check.
- **Depended on by:** Prepare-only return or encrypted submission construction.

```ts
// L307-L322
if (!input.submit) {
  writeEvent("broadcaster.transfer-prepared", ...);
  return { ..., canonicalTransactionHashResolved: false,
           receiptStatus: "NOT_SUBMITTED" };
}
```

- **What:** Ends reversible proof-only mode.
- **Why here:** It exits before `BroadcasterTransaction.create` installs a
  response key and before any journal mutation or Waku call.
- **Assumes:** Proof generation itself has no chain/Waku submission effect.
  Established by the invoked Wallet proof/population APIs being used only for
  local outputs in this function; their internal side effects are external.
- **Establishes:** `NOT_SUBMITTED` means this project path did not create/send a
  Waku transaction or reserve a submission.
- **Depended on by:** CLI preparation evidence.

```ts
// L324-L355
const preparedSubmission = await session.prepareSubmission(...nullifiers...);
const reservation = { payer, prepared quote, fee, nullifiers };
if (retryAmbiguous) {
  await submissionJournal.reserveBroadcasterRetry(request, reservation);
} else {
  await submissionJournal.reserveBroadcaster(request, reservation);
}
```

- **What:** Constructs the encrypted SDK request locally, then persists either a
  new attempt lineage or one bounded retry attempt before send.
- **Why here:** Every later Waku outcome has pre-send recovery identity.
- **Assumes:** `prepareSubmission` performs no LightPush. Established by the
  installed SDK create path at
  `tools/ppops-payer/node_modules/@railgun-community/waku-broadcaster-client-node/dist/transact/broadcaster-transaction.js:L41-L68`.
- **Assumes:** A retry using a newly generated proof with exactly the original
  nullifier set is a valid resubmission policy. Exact-set equality is established
  by `reserveBroadcasterRetry`; protocol idempotence is established by:
  **nothing found in project source**.
- **Establishes:** Initial send has a unique intent/cross-record nullifier
  reservation; retry has a `RESERVED` attempt with current quote/fee metadata and
  the same request, payer and nullifiers.
- **Depended on by:** `submitPrepared` and classified outcome recording.

```ts
// L357-L406
try { reportedHash = await session.submitPrepared(preparedSubmission); }
catch (error) {
  if (BroadcasterRejectedFailure) mark fresh REJECTED or retry REJECTED;
  else if (BroadcasterAmbiguousResponseFailure) mark ambiguity;
  throw error;
}
```

- **What:** Sends once through the prepared capability and records either a
  mapped rejection or a mapped/unclassified ambiguity before propagating failure.
- **Why here:** The journal distinguishes a hashless fresh terminal rejection
  from an unresolved initial/retry response while retaining stable enum values.
- **Assumes:** The exact SDK response strings classified as rejection or
  ambiguity carry those remote semantics. Project matching is established at
  `tools/ppops-payer/src/broadcaster/failures.ts:L39-L165`; the Broadcaster
  protocol meaning is established by: **nothing found** in project source.
- **Establishes:** Fresh classified rejection becomes `REJECTED`; retry rejection
  changes only the matching attempt; mapped or `UNCLASSIFIED_FAILURE` ambiguity
  keeps base status `SUBMITTING` and updates the matching retry when present.
- **Depended on by:** Operator status/recovery/retry workflow.

```ts
// L407-L448
await submissionJournal.markBroadcasterReported(request.id, reportedHash);
await engine.syncBalances();
const transactionHash = await engine.recoverTransactionHashForNullifiers(nullifiers);
if (!transactionHash) return { reportedHash, canonicalResolved: false, PENDING };
if (transactionHash !== reportedHash) emit mismatch;
await submissionJournal.markSubmitted(request.id, transactionHash);
```

- **What:** Stores the Waku/SDK result as metadata, refreshes wallet state, and
  derives canonical public identity from the complete nullifier set.
- **Why here:** The reported hash never drives receipt lookup.
- **Assumes:** Wallet sync exposes completed nullifier mappings and one shared
  txid is canonical. The installed Engine's all-nullifiers/same-txid rule is at
  `tools/ppops-payer/node_modules/@railgun-community/engine/dist/railgun-engine.js:L1255-L1275`; protocol-level canonical identity is established locally
  by: **nothing found**.
- **Establishes:** No mapping retains `SUBMITTING/PENDING`; a mapping advances to
  `SUBMITTED` with canonical hash regardless of reported-hash equality.
- **Depended on by:** Receipt quorum and `recoverBroadcaster`.

```ts
// L450-L495
const receipt = await readReceiptQuorum(config, transactionHash);
if (!receipt) return { transactionHash, canonicalResolved: true, PENDING };
await submissionJournal.markMined(request.id, receipt.blockNumber, receipt.succeeded);
if (!receipt.succeeded) throw TRANSACTION_REVERTED;
return { transactionHash, receiptStatus: "MINED", blockNumber, ... };
```

- **What:** Uses strict identical-receipt majority to record success/revert.
- **Why here:** Receipt authority begins only after canonical identity is durable.
- **Assumes:** Receipt quorum is the intended terminal evidence. Established by
  `readReceiptQuorum`
  (`tools/ppops-payer/src/railgun/rpc-quorum.ts:L121-L185`); finalized-height
  evidence is established by: **nothing found** in this path.
- **Establishes:** No quorum retains `SUBMITTED/PENDING`; quorum records
  `MINED|REVERTED` with block before return/rejection.
- **Depended on by:** CLI next step and PPOI finalization.

---

**Cross-Function Dependencies:**

- Caller `runBroadcaster` verifies live source/signer, amount and exact intent,
  checks payer identity, owns the engine/session lifecycle, and selects initial
  or retry mode (`tools/ppops-payer/src/cli.ts:L793-L905`).
- `SubmissionJournal` supplies initial uniqueness, cross-record nullifier
  collision checks, exact-set bounded retries, classified outcome state and
  forward canonical/receipt transitions
  (`tools/ppops-payer/src/security/submission-journal.ts:L289-L747`).
- `BroadcasterSession.prepareSubmission/submitPrepared` separates SDK encrypted
  construction from send and classifies selected response errors
  (`tools/ppops-payer/src/broadcaster/session.ts:L341-L517`).
- Wallet SDK estimation/proof/population/fee calls are external cryptographic and
  economic dependencies.
- `recoverTransactionHashForNullifiers` wraps Wallet/Engine completion lookup
  (`tools/ppops-payer/src/railgun/engine.ts:L253-L274`).
- `readReceiptQuorum` groups exact hash/block/status across configured providers
  (`tools/ppops-payer/src/railgun/rpc-quorum.ts:L121-L185`).

**Open Questions:**

- What remote/protocol contract makes each mapped response a definitive
  rejection or an unresolved chain outcome?
- What does Wallet SDK guarantee about note locking between proof generation,
  initial submission and a later same-nullifier retry, including another host
  using the same mnemonic?
- Does retransmission with the same nullifiers but a newly generated proof,
  Broadcaster, fee ID or fee amount preserve the intended transaction identity?
- How should an operator interpret retry exhaustion when no not-yet-attempted
  eligible Broadcaster remains before the three-attempt journal limit?
- What evidence distinguishes the causes grouped under
  `UNCLASSIFIED_FAILURE` before a same-nullifier retry decision?
- Does a passing public-RPC simulation differ materially from the selected
  Broadcaster's funded-sender/provider simulation, fee extraction or PPOI
  validation path?
- Is receipt-quorum `MINED` intentionally terminal before finalized height?
- The result exposes gas-price and final-simulation agreement separately; should
  a future evidence schema also retain the final/pre-proof estimate ratio?
