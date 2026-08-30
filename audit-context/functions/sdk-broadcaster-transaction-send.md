## `BroadcasterTransaction.send` / `broadcast` in installed `@railgun-community/waku-broadcaster-client-node@9.1.1` (`dist/transact/broadcaster-transaction.js` L69-L145)

**Purpose:** Repeatedly submits one encrypted transact message through Waku while
polling two completion channels: a decrypted Broadcaster response and a Wallet/
Engine mapping from the prepared nullifiers to a completed public transaction.

**Inputs & Assumptions:**

- Object state from `BroadcasterTransaction.create`: encrypted `messageData`,
  transact topic, TXID version, chain and nullifiers (L27-L40). Trust: internally
  constructed, but nullifier/calldata correspondence is caller-established.
- Static `BroadcasterTransactResponse.sharedKey/storedTransactionResponse`:
  process-global response state. Established by the most recent constructor.
- Implicit: Waku LightPush, Filter and Store services; registered transact-response
  observer; Wallet/Engine nullifier index; shared-model `poll` timing.
- Precondition: observers were installed for this chain. Established by Waku
  client startup through `WakuObservers.setObserversForChain`
  (`tools/ppops-payer/node_modules/@railgun-community/waku-broadcaster-client-node/dist/waku/waku-broadcaster-waku-core-base.js:L19-L29` and
  `tools/ppops-payer/node_modules/@railgun-community/waku-broadcaster-client-node/dist/waku/waku-observers.js:L49-L62`).
- Precondition: no newer transaction replaced the static response key. A package
  internal concurrency guard is established by: **nothing found**.

**Outputs & Effects:**

- LightPushes the same encrypted message during the retry phase; network send
  errors are logged through the optional debugger and polling continues.
- Queries Waku Store history for the transact-response topic on every retry loop.
- Returns an untagged transaction-hash value obtained either from decrypted
  response `txHash` or nullifier completion lookup.
- Clears static shared response state on returned hash or explicit decrypted
  response error.
- Throws on explicit Broadcaster error or when retry state reaches timeout.
- Does not clear static shared response state on the inspected timeout branch.

---

**Block-by-Block:**

```js
// L69-L80
async findMatchingNullifierTxid() {
  try {
    const { txid } = await getCompletedTxidFromNullifiers(
      this.txidVersionForInputs, this.chain, this.nullifiers,
    );
    return txid;
  } catch (cause) {
    BroadcasterDebug.error(...);
    return undefined;
  }
}
```

- **What:** Asks Wallet/Engine whether every prepared nullifier now identifies one
  completed transaction; lookup failure is converted to no result.
- **Why here:** Completion can be established even when the encrypted response is
  missing.
- **Assumes:** The Wallet/Engine nullifier mapping has been synchronized and a
  shared txid is canonical public identity. The installed Engine iterates UTXO
  trees newest-to-oldest and returns only when every input maps to the same txid
  (`tools/ppops-payer/node_modules/@railgun-community/engine/dist/railgun-engine.js:L1255-L1275`).
  Synchronization before this SDK method and protocol-level canonical identity
  are established inside this method by: **nothing found**.
- **Establishes:** A thrown lookup does not end Waku retry; a defined return is the
  Wallet/Engine's formatted hash.
- **Depended on by:** `getTransactionResponse`.

```js
// L82-L94
if (BroadcasterTransactResponse.storedTransactionResponse) {
  return BroadcasterTransactResponse.storedTransactionResponse;
}
const nullifiersTxid = await this.findMatchingNullifierTxid();
if (isDefined(nullifiersTxid)) {
  return { id: "nullifier-transaction", txHash: nullifiersTxid };
}
return undefined;
```

- **What:** Gives a decrypted Waku response priority, then falls back to the
  nullifier-derived transaction.
- **Why here:** Either channel can terminate the same retry loop.
- **Assumes:** Static stored response belongs to this transaction. Established by
  the static shared key installed at construction; concurrent replacement is
  established by: **nothing found**.
- **Assumes:** Decrypted response shape is trustworthy enough to inspect
  `txHash/error`. Response handler stores the decrypted value without a local
  schema
  (`tools/ppops-payer/node_modules/@railgun-community/waku-broadcaster-client-node/dist/transact/broadcaster-transact-response.js:L16-L44`).
  Cryptographic response authenticity is delegated to the Wallet encryption
  dependency; local response-shape establishment is: **nothing found**.
- **Establishes:** Callers receive `undefined` only when neither completion channel
  currently yields a value.
- **Depended on by:** The `poll` predicate at L130.

```js
// L95-L104
const retrySeconds = retryNumber * 2;
if (retrySeconds <= 20) return RetryTransact;
if (retrySeconds >= 120) return Timeout;
return Wait;
```

- **What:** Converts recursive retry count to send/wait/timeout phases.
- **Why here:** Waku retransmission stops after the early phase while response/
  nullifier polling continues.
- **Assumes:** Recursive iteration plus Store/poll latency approximates this
  seconds model. Exact wall-clock upper bound is established by: **nothing found**
  because network queries also consume time.
- **Establishes:** No further LightPush occurs in `Wait`; `Timeout` throws before
  another Store query.
- **Depended on by:** `broadcast` switch.

```js
// L105-L126
async send() { return this.broadcast(); }
const state = this.getBroadcastRetryState(retryNumber);
switch (state) {
  case RetryTransact:
    try { await broadcastMessage(messageData, contentTopic); }
    catch (err) { BroadcasterDebug.log(...); }
    break;
  case Wait: break;
  case Timeout: throw new Error("Request timed out.");
}
```

- **What:** Starts recursion at zero; retry-state calls LightPush and absorbs
  transport errors, wait-state only polls, timeout-state rejects.
- **Why here:** A single transient send failure does not erase the possibility
  that an earlier retransmission reached a Broadcaster.
- **Assumes:** Repeated delivery of identical encrypted transact data is handled
  idempotently by remote Broadcasters/protocol. Established by: **nothing found
  in this client package**.
- **Establishes:** After any send attempt, completion polling proceeds; timeout is
  an ambiguous result rather than proof of non-submission.
- **Depended on by:** PPOps's pre-send journal reservation/recovery policy.

```js
// L127-L145
const pollIterations = 2 / 0.1;
const responseTopic = contentTopics.transactResponse(this.chain);
await retrieveHistoricalForTopic(responseTopic);
const response = await poll(
  () => this.getTransactionResponse(), result => result != null, 100, pollIterations,
);
if (isDefined(response?.txHash)) {
  clearSharedKey();
  return response.txHash;
}
if (isDefined(response?.error)) {
  clearSharedKey();
  throw new Error("Received response error from broadcaster.", ...);
}
return this.broadcast(retryNumber + 1);
```

- **What:** Pulls Store history, polls current response/nullifier state for 20
  iterations, returns a hash or error, otherwise recurses.
- **Why here:** Filter delivery, Store history and local chain completion can all
  satisfy a response window.
- **Assumes:** `poll` invokes the callback as configured and a non-null decrypted
  object is meaningful. `poll` is imported from shared models and was not part of
  this package's visible implementation; further establishment is provided by:
  **nothing found in this package**.
- **Establishes:** Hash/error paths clear response state; no-result paths continue
  until timeout.
- **Depended on by:** Project `submitPrepared`, which applies final hash syntax
  validation.

---

**Cross-Function Dependencies:**

- Caller `BroadcasterSession.submitPrepared` (project) invokes `send`, validates
  hash syntax, classifies exact recognized response-error strings and maps every
  otherwise unrecognized post-send failure to the
  `UNCLASSIFIED_FAILURE` ambiguity category
  (`tools/ppops-payer/src/broadcaster/session.ts:L480-L517`).
- Callee `WakuBroadcasterWakuCore.broadcastMessage` (same package) JSON-encodes
  and LightPushes the encrypted message; it throws only when failures exist and
  none were accepted
  (`tools/ppops-payer/node_modules/@railgun-community/waku-broadcaster-client-node/dist/waku/waku-broadcaster-waku-core-base.js:L126-L146`).
- Callee `retrieveHistoricalForTopic` (same package) queries Store from a cursor
  or recent lookback and dispatches messages through the registered callback;
  retrieval errors are logged and swallowed
  (`tools/ppops-payer/node_modules/@railgun-community/waku-broadcaster-client-node/dist/waku/waku-broadcaster-waku-core-base.js:L147-L194`).
- Callee `BroadcasterTransactResponse.handleBroadcasterTransactionResponseMessage`
  (same package) decrypts payloads through static shared key and stores the
  decrypted object
  (`tools/ppops-payer/node_modules/@railgun-community/waku-broadcaster-client-node/dist/transact/broadcaster-transact-response.js:L16-L44`).
- Callee `getCompletedTxidFromNullifiers` (Wallet/Engine dependency) is also used
  independently by PPOps after send, so a Waku-returned hash is not receipt
  authority (`tools/ppops-payer/src/railgun/engine.ts:L253-L274`).

**Open Questions:**

- Is retransmission of identical encrypted calldata idempotent for every allowed
  Broadcaster version?
- What exact response schema and authentication property does
  `decryptAESGCM256` establish before the object is stored?
- Can a response encrypted under an earlier static key be delivered after a new
  transaction replaces that key, and how is that lifecycle intended to work?
- Does the Wallet/Engine nullifier lookup require a refresh initiated elsewhere,
  or can its backing trees update during the Waku loop?
- What cleanup owns the static key/response after timeout?
- Which SDK response-error strings are a stable protocol interface rather than
  dependency implementation text consumed by the project classifier?
