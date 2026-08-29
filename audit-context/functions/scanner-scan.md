## `RailgunScanner.scan` in `src/railgun/scanner.ts` (L100-L145)

**Purpose:** Runs one non-overlapping receiver-wallet refresh, selects positive
ERC-20 notes carrying strict PPOps memos, and returns normalized settlement
candidates.

**Inputs & Assumptions:**

- Constructor-held view-only engine and parsed config.
- Implicit: RAILGUN wallet/LevelDB/provider/PPOI state, RPC quorum, active TXID
  versions, and SDK scan completion callbacks. Established by: engine/scanner
  construction and pinned SDK dependencies.
- Precondition: engine has started and exposes a wallet ID. Established by
  `PPOpsRuntime.create` before scanner construction (`src/runtime.ts:L58-L60`).
- Precondition: no scan is already active on this scanner. Checked by
  `this.scanning` at L101-L102.

**Outputs & Effects:**

- Refreshes SDK balance/wallet scan state.
- Reads all TXOs for every `ACTIVE_TXID_VERSIONS` value.
- Returns only normalized positive ERC-20 TXOs with a fully matching PPOps memo.
- Performs receipt/block/finality reads through `RpcQuorum` while normalizing.
- Always resets the in-memory `scanning` flag in `finally`.

---

**Block-by-Block:**

```ts
// L101-L116
if (this.scanning) throw ...;
this.scanning = true;
...
await Promise.all([refreshBalances(...), walletScanComplete]);
```

- **What:** Serializes scans within the object and waits for the SDK's refresh
  and wallet-scan promises.
- **Why here:** The source comment records that refresh cannot be cancelled and
  overlapping LevelDB scans must not be started (`L109-L112`).
- **Assumes:** The two SDK promises jointly mean TXO state is ready to enumerate.
  Established by: **nothing found in project source**.
- **Establishes:** Later TXO reads occur after both promises resolve.
- **Depended on by:** Note enumeration and daemon health success.

```ts
// L118-L133
const txos = (await Promise.all(ACTIVE_TXID_VERSIONS.map(...wallet.TXOs...))).flatMap(...);
const referenceTXOs = txos.filter(({ txo }) => {
  if (txo.note.tokenData.tokenType !== TokenType.ERC20 || txo.note.value <= 0n) return false;
  return parsePPOpsReference(txo.note.memoText) !== undefined;
});
```

- **What:** Enumerates versioned notes and applies token/value/memo admission.
- **Why here:** Non-payment notes never cause RPC normalization work or database
  reconciliation.
- **Assumes:** Decrypted `memoText`, token data, value, transaction ID, and output
  coordinates returned by SDK are authoritative for this wallet. Established
  by: the pinned Wallet SDK interface; independent derivation is established by:
  **nothing found in project source**.
- **Establishes:** Every candidate is positive ERC-20 and has a 32-byte PPOps
  reference under the exact grammar (`src/domain.ts:L110-L113`).
- **Depended on by:** `normalizeTXO` and downstream amount/reference arithmetic.

```ts
// L134-L141
const chainContext = await this.chainContext();
const blockTimestampCache = new Map<number, Promise<number>>();
return mapWithConcurrency(referenceTXOs, 8, (...) => this.normalizeTXO(...));
```

- **What:** Gets a quorum chain context once, caches block timestamps, and
  normalizes up to eight notes concurrently.
- **Why here:** Candidates in one pass use one finality snapshot; repeated block
  reads are coalesced.
- **Assumes:** Using one context for the scan is the intended consistency model.
  Established by: the single `chainContext` call at `L134`; a separate product
  specification for that choice is established by: **nothing found**.
- **Establishes:** Output ordering follows input indexes despite concurrent work
  (`mapWithConcurrency`, L38-L59).
- **Depended on by:** `PPOpsRuntime.scanOnce` reconciliation loop.

```ts
// L142-L144
} finally {
  this.scanning = false;
}
```

- **What:** Releases object-level scan exclusivity on every path.
- **Why here:** Failures must permit a later scheduled retry.
- **Establishes:** No completed/rejected call leaves the flag intentionally set.

---

**Cross-Function Dependencies:**

- Callee `parsePPOpsReference` (internal): exact anchored memo grammar.
- Callee `normalizeTXO` (internal): constructs identity, finality, timestamp,
  token/amount, and PPOI state; see its separate record.
- Callee `RpcQuorum.chainContext/getReceipt/getBlock` (internal plus external
  providers): majority agreement.
- RAILGUN Wallet SDK and engine types are external dependencies.
- Callers: `PPOpsRuntime.scanOnce`; daemon scheduler avoids overlap and scanner
  itself rejects it.
- Shared state: `scanning`, SDK wallet cache, RPC providers.

**Open Questions:**

- Precise SDK guarantee that `awaitWalletScan + refreshBalances` covers PPOI
  updates needed by `POI.getBalanceBucket` is not stated in project source.
