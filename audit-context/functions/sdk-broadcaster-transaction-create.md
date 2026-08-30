## `BroadcasterTransaction.create` in installed `@railgun-community/waku-broadcaster-client-node@9.1.1` (`dist/transact/broadcaster-transaction.js` L21-L68)

**Purpose:** Builds the pinned Waku client's encrypted transact request and
installs the symmetric response state later consumed by `send`. PPOps relies on
this function to be local preparation only: no LightPush occurs here.

**Inputs & Assumptions:**

- TXID version, target, calldata, Broadcaster 0zk address/fee ID, chain,
  nullifiers, gas floor, relay-adapt flag and pre-transaction PPOIs: supplied by
  `BroadcasterSession.prepareSubmission`. Trust: mixed validated project/Wallet
  SDK data.
- Implicit: Wallet SDK implementations of RAILGUN address decoding and
  `encryptDataWithSharedKey`, global `BroadcasterConfig` version/dev settings and
  static `BroadcasterTransactResponse` state.
- Precondition: calldata is a hex string and target is an EVM address. Established
  here at L46-L54; PPOps also validates target/data before this boundary.
- Precondition: Broadcaster address contains the intended viewing public key.
  Address parsing occurs at L49; independent selection trust is established by
  PPOps quote validation, not by this function.
- Precondition: there is no other active transaction whose response key must
  remain installed. A concurrency guard in this package is established by:
  **nothing found**; response state is static at
  `tools/ppops-payer/node_modules/@railgun-community/waku-broadcaster-client-node/dist/transact/broadcaster-transact-response.js:L5-L15`.

**Outputs & Effects:**

- Returns a `BroadcasterTransaction` containing encrypted message payload,
  transact topic, TXID version, chain and nullifiers.
- Calls Wallet SDK encryption with the Broadcaster viewing public key.
- Sets one process-global response shared key and clears any previously stored
  response through the constructor.
- Performs no LightPush, Store query or receipt lookup.

---

**Block-by-Block:**

```js
// L41-L44
static async create(...inputs) {
  const encryptedDataResponse = await this.encryptTransaction(...inputsExceptNullifiers);
  return new BroadcasterTransaction(
    encryptedDataResponse, txidVersionForInputs, chain, nullifiers,
  );
}
```

- **What:** Separates encrypted request construction from local recovery metadata,
  then creates the transaction wrapper.
- **Why here:** Nullifiers remain local object state used for completion lookup;
  they are not included in `transactData` at L50-L65.
- **Assumes:** The nullifiers correspond exactly to the encrypted proxy calldata.
  Established by PPOps passing both from one `populateProvedTransfer` result;
  this SDK function does not compare them.
- **Establishes:** One transaction object binds the encrypted request to local
  chain/version/nullifier lookup state.
- **Depended on by:** `BroadcasterTransaction.send/getTransactionResponse`.

```js
// L45-L65
if (!isHexString(data)) throw;
const { viewingPublicKey } = getRailgunWalletAddressData(broadcasterRailgunAddress);
const transactData = {
  transactType: COMMON,
  txidVersion, to: getAddress(to), data,
  broadcasterViewingKey: bytesToHex(viewingPublicKey),
  chainID, chainType, minGasPrice: overallBatchMinGasPrice.toString(),
  feesID, useRelayAdapt, devLog,
  minVersion, maxVersion,
  preTransactionPOIsPerTxidLeafPerList,
};
```

- **What:** Constructs the plaintext object later encrypted for the Broadcaster.
- **Why here:** Target/chain/fee/gas/version/PPOI semantics travel together under
  one encryption call.
- **Assumes:** The selected `feesID`, version range, gas floor and PPOI structure
  are meaningful to the remote Broadcaster. Established by upstream cache/
  project checks for fee/version/gas; PPOI interpretation is established by:
  **nothing found in this package** beyond forwarding it.
- **Establishes:** The plaintext has a checksum EVM target, decimal gas floor and
  explicit chain/type/version flags.
- **Depended on by:** Encryption and remote Broadcaster execution.

```js
// L66-L68
const encryptedDataResponse = await encryptDataWithSharedKey(
  transactData,
  broadcasterViewingKey,
);
return encryptedDataResponse;
```

- **What:** Delegates encryption/key generation to the installed Wallet package.
- **Why here:** The Waku message contains only random public key plus encrypted
  bytes, while the local side retains the shared response key.
- **Assumes:** Wallet encryption provides confidentiality/integrity and creates a
  shared key usable for response decryption. Established by: **nothing found in
  this package**; `encryptDataWithSharedKey` is an external Wallet dependency.
- **Establishes:** Success yields encrypted payload, ephemeral/random public key
  and shared key expected by the constructor.
- **Depended on by:** Constructor and response handler.

```js
// L27-L40
this.messageData = { method: "transact", params: { pubkey, encryptedData } };
this.contentTopic = contentTopics.transact(chain);
this.txidVersionForInputs = txidVersionForInputs;
this.chain = chain;
this.nullifiers = nullifiers;
BroadcasterTransactResponse.setSharedKey(encryptedDataResponse.sharedKey);
```

- **What:** Stores Waku request/recovery state and installs the process-global
  response key, which also clears the previous stored response.
- **Why here:** `send` can later broadcast without holding plaintext transact data
  and can correlate response/completion through key or nullifiers.
- **Assumes:** One static shared key is sufficient for all active transactions.
  A multi-transaction correlation mechanism is established by: **nothing found**.
- **Establishes:** This object is ready for `send`; the shared response slot now
  belongs to its encryption exchange.
- **Depended on by:** Waku response decryption and `broadcast` polling.

---

**Cross-Function Dependencies:**

- Caller `BroadcasterSession.prepareSubmission` (project) supplies the current
  quote and validated populated data
  (`tools/ppops-payer/src/broadcaster/session.ts:L445-L470`).
- Callee `getRailgunWalletAddressData` (external Wallet package) extracts the
  Broadcaster viewing public key.
- Callee `encryptDataWithSharedKey` (external Wallet package) supplies encrypted
  data, random public key and response shared key.
- Callee `BroadcasterTransactResponse.setSharedKey` (same installed package)
  replaces static key and clears static response
  (`tools/ppops-payer/node_modules/@railgun-community/waku-broadcaster-client-node/dist/transact/broadcaster-transact-response.js:L5-L15`).
- Callee `contentTopics.transact` (same installed package) selects
  `/railgun/v2/<chain>-transact/json`
  (`tools/ppops-payer/node_modules/@railgun-community/waku-broadcaster-client-node/dist/waku/waku-topics.js:L1-L8`).
- Package provenance: exact version, resolved tarball and integrity are locked at
  `tools/ppops-payer/package-lock.json:L3661-L3676`.

**Open Questions:**

- What are the exact cryptographic guarantees and input validation of
  `encryptDataWithSharedKey` in the paired Wallet version?
- Are nullifiers intentionally excluded from encrypted `transactData`, and does
  the remote Broadcaster derive/validate them independently from calldata?
- Is a single static shared response key an explicit one-transaction-per-process
  API contract?
- Which component validates the complete shape and list membership of
  `preTransactionPOIsPerTxidLeafPerList` before remote execution?
