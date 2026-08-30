## `BroadcasterSession.prepareSubmission` in `tools/ppops-payer/src/broadcaster/session.ts` (L445-L478)

**Purpose:** Converts a locally populated RAILGUN proxy call into one encrypted,
quote-bound Waku Broadcaster transaction without sending it. It is the last
reversible Gate B step before the payer writes its durable nullifier reservation.

**Inputs & Assumptions:**

- `selected` (`ValidatedBroadcaster`): proof-time or recently revalidated quote.
  Trust: semi-trusted Waku-cache data that passed address/token/fee/lifetime/
  reliability checks in `validateBroadcaster` (L87-L148).
- `to` and `data`: populated private-transfer proxy target/calldata. Trust:
  internal Wallet SDK output validated against the configured RAILGUN proxy and
  zero ETH value before this call
  (`tools/ppops-payer/src/railgun/populated-transfer.ts:L29-L59`).
- `nullifiers`: one to 64 normalized, unique, nonzero 32-byte values. Trust:
  Wallet SDK output validated by `assertPopulatedNullifiers`
  (`tools/ppops-payer/src/railgun/populated-transfer.ts:L10-L27`).
- `overallBatchMinGasPrice`: positive legacy gas price selected from a configured
  provider majority (`tools/ppops-payer/src/railgun/rpc-quorum.ts:L52-L103`).
- `preTransactionPOIsPerTxidLeafPerList`: opaque Wallet SDK population output.
  Trust: external SDK result; project-side shape/semantic validation is
  established by: **nothing found**.
- Implicit: a started `BroadcasterSession`, current Waku fee cache, system clock,
  `PAYER_TXID_VERSION`, Arbitrum chain profile and installed
  `@railgun-community/waku-broadcaster-client-node@9.1.1`.
- Precondition: no other in-process Broadcaster transaction replaces the local
  SDK's static response shared key between preparation and send. The normal CLI
  executes one Gate B operation under `PayerRuntimeLock`; arbitrary exported
  class consumers are covered by: **nothing found**.

**Outputs & Effects:**

- Returns `{ quote, send }`, where `quote` is the exact live quote used to create
  the encrypted request and `send` closes over one SDK `BroadcasterTransaction`.
- Rechecks the cached quote and may substitute a proof-compatible successor with
  the same Broadcaster address, token and fee-per-gas but a newer fee ID/expiry.
- Constructs encrypted message data and installs the SDK's process-global
  response shared key; it does not broadcast Waku data.
- Maps all construction errors to `BROADCASTER_SUBMISSION_FAILED` without exposing
  the caught cause through this function's return.

---

**Block-by-Block:**

```ts
// L453-L454
const module = this.requireStarted();
const current = this.assertQuoteStillCurrent(input.selected);
```

- **What:** Requires the dynamically imported client to have completed startup
  and resolves an exact or proof-compatible live quote from its current cache.
- **Why here:** The encrypted request must carry a fee ID that is still cached as
  acceptable at construction time.
- **Assumes:** `started` plus loaded module is enough readiness for local
  construction. Established by `requireStarted` at L519-L524; current network
  connection status is not consulted here.
- **Assumes:** Equal Broadcaster address, token and fee-per-gas preserve the
  proof-bound fee recipient and amount across fee-ID rotation. Established by
  `proofCompatibleQuote` at L150-L163; the Broadcaster-side acceptance contract
  is established by: **nothing found in project source**.
- **Establishes:** `current` passed all current lifetime/reliability/identity
  validation and is compatible with the proof-time quote.
- **Depended on by:** SDK transaction construction and journal quote identity.

```ts
// L456-L469
const transaction = await module.BroadcasterTransaction.create(
  PAYER_TXID_VERSION,
  input.to,
  input.data,
  current.selected.railgunAddress,
  current.selected.tokenFee.feesID,
  NETWORK_CONFIG[PAYER_NETWORK].chain,
  input.nullifiers,
  input.overallBatchMinGasPrice,
  false,
  input.preTransactionPOIsPerTxidLeafPerList,
);
```

- **What:** Calls the pinned local Waku client with the proof's transaction
  version, proxy calldata, selected Broadcaster/fee ID, Arbitrum identity,
  recovery nullifiers, gas floor, no relay-adapt and pre-transaction PPOI data.
- **Why here:** Construction is completed before any durable reservation or
  irreversible network send.
- **Assumes:** The passed proxy data/nullifiers/PPOI all describe the same proof.
  Established by their common `populateProvedTransfer` result in the caller
  (`tools/ppops-payer/src/railgun/broadcaster-transfer.ts:L273-L298`); the project
  does not cryptographically recompute that binding.
- **Assumes:** The pinned SDK encrypts the payload to the selected Broadcaster's
  viewing key and associates the response shared key with this transaction.
  Established by the inspected local implementation at
  `tools/ppops-payer/node_modules/@railgun-community/waku-broadcaster-client-node/dist/transact/broadcaster-transaction.js:L41-L68`.
- **Establishes:** One local SDK transaction object has encrypted message data,
  topic, chain/version/nullifiers and the response shared key expected by send.
- **Depended on by:** The closure returned at L470 and subsequent journal reserve.

```ts
// L470
return { quote: current, send: () => transaction.send() };
```

- **What:** Returns the exact construction quote and a zero-argument send closure.
- **Why here:** The caller can persist the same quote/nullifiers before invoking
  the irreversible method, without exposing the SDK object itself.
- **Assumes:** The closure is invoked at most once by the Gate B lifecycle. The
  standard caller invokes it once through `submitPrepared`; enforcement inside
  the closure is established by: **nothing found**.
- **Establishes:** No Waku send has occurred before return; the caller has a
  prepared action and its matching quote.
- **Depended on by:** `sendBroadcasterTransfer` L324-L359.

```ts
// L471-L476
catch (error) {
  throw new SafeFailure(
    "BROADCASTER_SUBMISSION_FAILED",
    "Unable to prepare the encrypted Broadcaster submission",
    { cause: error },
  );
}
```

- **What:** Normalizes all SDK construction failures.
- **Why here:** Local preparation failure occurs before the journal reservation,
  so the caller can distinguish it only by stable failure code.
- **Assumes:** The cause remains internal until final serialization. Established
  by `safeFailureResult` returning only a code
  (`tools/ppops-payer/src/events.ts:L60-L65`).
- **Establishes:** This function either returns a prepared closure or rejects with
  `BROADCASTER_SUBMISSION_FAILED`.
- **Depended on by:** CLI failure output and the no-reservation-before-preparation
  ordering.

---

**Cross-Function Dependencies:**

- Callee `requireStarted` (internal, L519-L524) checks only module presence and
  the local `started` flag.
- Callee `assertQuoteStillCurrent` (internal, L414-L439) reads SDK cached quotes,
  validates each candidate and selects exact fingerprint first, then identical
  address/token/rate.
- Callee `selectSubmissionBroadcaster` (internal, L165-L194) ignores candidates
  that fail project quote validation; it does not fetch a quote independently.
- Callee `BroadcasterTransaction.create` (external-source-available) validates
  hex calldata/checksum target, derives the Broadcaster viewing public key,
  includes chain/gas/fee/version/PPOI fields, encrypts them through Wallet SDK,
  and stores one static response shared key
  (`tools/ppops-payer/node_modules/@railgun-community/waku-broadcaster-client-node/dist/transact/broadcaster-transaction.js:L27-L68`).
- Caller `sendBroadcasterTransfer` (internal) supplies validated population
  output, persists `prepared.quote` and nullifiers, then calls `submitPrepared`
  (`tools/ppops-payer/src/railgun/broadcaster-transfer.ts:L324-L359`).
- Shared state: the installed Waku client uses static client/config/cache and
  response state across `BroadcasterSession` instances.

**Open Questions:**

- What Broadcaster protocol guarantee permits the compatible successor fee ID
  after the proof was generated with the same address/token/rate but an earlier
  quote identity?
- Does the Wallet SDK guarantee that populated calldata, pre-transaction PPOIs
  and returned nullifiers are one inseparable result, or can callers mix results
  without the Waku client detecting it?
- Is more than one prepared transaction per process supported by the pinned SDK's
  single static response shared key?
- Does `started=true` remain sufficient when Waku status has moved to
  `Disconnected` or `Error` between startup and construction?
