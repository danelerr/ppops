## `recoverBroadcaster` in `tools/ppops-payer/src/cli.ts` (L907-L1035)

**Purpose:** Interprets and advances an existing Gate B lineage without creating
a proof or sending Waku data. It reports terminal rejection/receipt state, or
rederives canonical public identity from reserved nullifiers and queries receipt
quorum.

**Inputs & Assumptions:**

- CLI options: payer config, one `pi_<32-byte>` intent ID and independently
  expected payer 0zk address. Trust: local operator input restricted at
  L908-L913.
- Existing strict `BROADCASTER` journal record read from the wallet-adjacent
  owner-only file. Trust: durable local state.
- Payer DB key and, only when wallet state is absent, mnemonic loaded by
  `loadRuntimeSecrets(config, false)`; Gate A self-signing key is not requested.
- Precondition: journal payer and loaded full-wallet payer match the independent
  expectation. Established before the early branches at L924-L931 and again
  inside engine work at L961-L965.
- Precondition: reserved nullifiers are the exact transaction recovery identity.
  Per-record validation and initial/retry equality are established by the
  journal; protocol-level nullifier-to-public-hash uniqueness is established by:
  **nothing found** in project source.
- Concurrency precondition: the journal record remains applicable between the
  initial read and later writes. Engine access is locked inside `withEngine`, but
  the initial read and subsequent `mark*` calls sit outside that lock; additional
  journal serialization is established by: **nothing found**.

**Outputs & Effects:**

- `REJECTED` returns stored rejection category, no canonical hash,
  `paymentRetryPermitted:false` and `freshIntentPermitted:true` without opening
  the wallet engine.
- `MINED|REVERTED` returns stored canonical hash/block and no retry without
  rechecking chain state.
- A current nullifier lookup miss preserves state, reports no canonical hash and
  sets `sameNullifierRetryAvailable` only for hashless `SUBMITTING` with fewer
  than three retry attempts; `paymentRetryPermitted` remains false.
- A canonical lookup result must match any stored canonical hash, then advances
  `SUBMITTING -> SUBMITTED` or retains `SUBMITTED`.
- Receipt quorum absence returns `SUBMITTED`; quorum advances to
  `MINED|REVERTED`.
- Does not start Waku, load Broadcaster trust configuration, fetch a merchant
  request, generate a proof, or invoke the retry command.

---

**Block-by-Block:**

```ts
// L907-L931
assertAllowed(["config", "intent-id", "expected-payer"]);
validate intentId;
const record = await journal.get(intentId);
require record?.submissionMode === "BROADCASTER";
require record.payerRailgunAddress;
assertExpectedPayerAddress(record.payerRailgunAddress, expectedPayer);
```

- **What:** Anchors recovery in a strict local Broadcaster record and expected
  payer identity.
- **Why here:** Operator-supplied nullifiers or reported hashes cannot create a
  recovery lineage.
- **Assumes:** `get` identifies one record for the intent. Public reservation
  methods preserve uniqueness under serialized use; schema-level duplicate
  intent detection is established by: **nothing found**.
- **Establishes:** Remaining paths operate on a Broadcaster record owned by the
  expected payer.
- **Depended on by:** All status and engine branches.

```ts
// L932-L956
if (status === "REJECTED") output({ rejectionCode, freshIntentPermitted: true, ... });
if (status === "MINED" || status === "REVERTED") {
  output({ transactionHash, blockNumber, canonicalResolved: true, ... });
}
```

- **What:** Returns journaled terminal states without secret loading or network
  calls.
- **Why here:** These states already carry their required hashless-rejection or
  hash/block receipt evidence under the journal schema.
- **Assumes:** A mapped Broadcaster rejection is terminal for this intent, and a
  stored receipt result remains authoritative. The state grammar is established
  by `SubmissionRecordSchema`
  (`tools/ppops-payer/src/security/submission-journal.ts:L70-L246`); remote
  rejection semantics and later chain finality are established by: **nothing
  found** in this command.
- **Establishes:** Early terminal paths neither open the engine nor mutate the
  journal.
- **Depended on by:** Operator fresh-intent/no-retry workflow.

```ts
// L959-L966
require record.nullifiers;
const transactionHash = await withEngine(config, secrets, async engine => {
  assert engine payer === expected payer === journal payer;
  await engine.syncBalances();
  return engine.recoverTransactionHashForNullifiers(record.nullifiers);
});
```

- **What:** Synchronizes the original payer wallet under its runtime lock and
  queries completion for the complete reserved nullifier set.
- **Why here:** Canonical identity comes from payer wallet state, not
  `reportedTransactionHash`.
- **Assumes:** Wallet creation block/sync cover the transaction and every
  nullifier mapping to one txid identifies the intended public transaction.
  Refresh and installed lookup mechanics are established at L961-L966 and
  `tools/ppops-payer/node_modules/@railgun-community/engine/dist/railgun-engine.js:L1255-L1275`; protocol uniqueness is established locally by:
  **nothing found**.
- **Establishes:** Defined result is a syntax-normalized hash from the payer
  engine wrapper; undefined means no complete mapping in current synchronized
  state.
- **Depended on by:** Pending, conflict and transition branches.

```ts
// L967-L983
if (!transactionHash) {
  output({ recovered: false, status, reportedHash?,
           paymentRetryPermitted: false,
           sameNullifierRetryAvailable:
             status === "SUBMITTING" && !reportedHash && retryCount < 3 });
  return;
}
```

- **What:** Reports continuing canonical uncertainty and a derived retry
  availability flag without changing durable state.
- **Why here:** Lookup absence is not treated as proof of non-submission.
- **Assumes:** External operator automation distinguishes a fresh payment retry
  from the dedicated same-nullifier retry. The flags establish CLI output only;
  their consumption is established by: **nothing found** in this repository.
- **Establishes:** No hash-missing recovery branch sends or mutates; retry
  availability is purely the displayed state/attempt-count predicate.
- **Depended on by:** Repeated recovery or a separate `retry-broadcaster` command.

```ts
// L985-L1000
if (record.transactionHash && record.transactionHash !== transactionHash) {
  throw JOURNAL_UPDATE_FAILED;
}
await journal.markSubmitted(intentId, transactionHash);
```

- **What:** Checks the original snapshot for canonical conflict and advances or
  idempotently retains `SUBMITTED`.
- **Why here:** Receipt lookup starts only after canonical identity is durable.
- **Assumes:** No writer changed the record while `withEngine` ran. The runtime
  lock was released when `withEngine` returned; journal locking at this point is
  established by: **nothing found**.
- **Establishes:** Successful update binds the canonical hash to `SUBMITTED`.
- **Depended on by:** Receipt quorum.

```ts
// L1002-L1034
const receipt = await readReceiptQuorum(config, transactionHash);
if (!receipt) output({ status: "SUBMITTED", receiptQuorum: false, ... });
else {
  await journal.markMined(intentId, receipt.blockNumber, receipt.succeeded);
  output({ status: succeeded ? "MINED" : "REVERTED", receiptQuorum: true, ... });
}
```

- **What:** Preserves nonterminal canonical state without quorum or records the
  exact quorum-observed outcome.
- **Why here:** Only nullifier-derived identity reaches public receipt authority.
- **Assumes:** Identical configured-provider receipt quorum is intended terminal
  evidence. Established by `readReceiptQuorum`
  (`tools/ppops-payer/src/railgun/rpc-quorum.ts:L121-L185`); finalized height is
  established by: **nothing found** in this path.
- **Establishes:** Outputs match the just-preserved or just-written journal
  state, with `paymentRetryPermitted:false`.
- **Depended on by:** `submission-status` and `finalize-poi`.

---

**Cross-Function Dependencies:**

- `SubmissionJournal.get/markSubmitted/markMined` supplies strict owner-only
  state and forward transitions
  (`tools/ppops-payer/src/security/submission-journal.ts:L289-L302`,
  `L650-L702`).
- `loadRuntimeSecrets(config, false)` and `withEngine` load only payer-wallet
  material and hold `PayerRuntimeLock` for engine lifetime
  (`tools/ppops-payer/src/cli.ts:L295-L320`, `L655-L692`).
- `recoverTransactionHashForNullifiers` wraps Wallet/Engine lookup and hash
  syntax (`tools/ppops-payer/src/railgun/engine.ts:L253-L274`).
- `readReceiptQuorum` groups exact hash/block/status across configured providers
  (`tools/ppops-payer/src/railgun/rpc-quorum.ts:L121-L185`).
- `main` exposes this function as `recover-broadcaster`; the same-nullifier retry
  is a separate `runBroadcaster(..., true)` path
  (`tools/ppops-payer/src/cli.ts:L1084-L1092`).

**Open Questions:**

- What evidence/time horizon tells an operator to use same-nullifier retry rather
  than continue recovery when the canonical lookup remains empty?
- Is `sameNullifierRetryAvailable` intended to require a journaled ambiguity
  category, or is any hashless `SUBMITTING` state within the count eligible?
- What serialization rule covers the read-before-lock and write-after-lock
  journal lifecycle?
- Are `REJECTED`, `MINED` and `REVERTED` ever revalidated against remote
  Broadcaster semantics or finalized-chain state?
- Is `paymentRetryPermitted:false` machine-consumed or solely advisory output?
