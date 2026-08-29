## `RailgunScanner.normalizeTXO` in `src/railgun/scanner.ts` (L168-L214)

**Purpose:** Reduces one admitted RAILGUN TXO to the durable PPOps settlement
schema, including stable identity, public-chain finality, and PPOI status.

**Inputs & Assumptions:**

- `txidVersion`: SDK-provided active version. Trust: semi-trusted external
  dependency data.
- `txo`: view-only SDK note already filtered by `scan`. Trust: semi-trusted.
- `chainContext`: quorum-derived latest/finalized heights.
- `timestampCache`: scan-local promise cache.
- Precondition: TXO memo contains a valid PPOps reference. Established by
  `scan` filter and rechecked at L174-L175.
- Precondition: token is positive ERC-20. Established by `scan` at L128-L133;
  not rechecked here.

**Outputs & Effects:**

- Returns a `NormalizedSettlement`; no direct durable writes.
- Performs quorum receipt and block reads.
- Uses a missing or non-success receipt to emit `chainStatus: REVERTED`.
- Maps SDK balance bucket/raw statuses into PPOps POI status.

---

**Block-by-Block:**

```ts
// L174-L183
const reference = parsePPOpsReference(txo.note.memoText);
if (!reference) throw ...;
const transactionHash = normalizeTransactionHash(txo.txid);
const receipt = await this.rpc.getTransactionReceipt(transactionHash);
const blockNumber = receipt?.blockNumber ?? txo.blockNumber;
/* cached getBlock(blockNumber) */
```

- **What:** Revalidates memo, normalizes public hash, resolves receipt block, and
  obtains timestamp.
- **Why here:** Identity and status depend on canonical public-chain context.
- **Assumes:** `txo.txid` is the public transaction hash accepted by RPC. This is
  established by: **nothing found in project source**.
- **Establishes:** Block timestamp is quorum-derived for the selected block.
- **Depended on by:** Unique ID, late-payment classification, finality.

```ts
// L184-L187
const rawPPOIStatuses = rawStatusesFor(txo);
const balanceBucket = POI.getBalanceBucket(txo) as ...;
```

- **What:** Preserves raw per-list status strings and obtains the SDK's balance
  bucket.
- **Why here:** Both raw and reduced state are stored for later reconciliation.
- **Assumes:** SDK bucket semantics remain compatible with `bucketToPOIStatus`.
  Established by: the pinned SDK enum/API plus the exhaustive local mapping at
  `L61-L82`; protocol meaning beyond that API is established by: **nothing
  found in project source**.
- **Establishes:** A deterministic PPOps POI classification for this observed
  SDK object (`L61-L82`).
- **Depended on by:** Credit eligibility and historical spent-state handling.

```ts
// L188-L213
return {
  uniqueSettlementId: `${chainId}:${version}:${hash}:${tree}:${position}`,
  ...,
  chainStatus: receipt && receipt.status === 1 ? this.chainStatusFor(...) : "REVERTED",
  poiStatus: bucketToPOIStatus(...),
  reference,
};
```

- **What:** Constructs the complete normalized candidate.
- **Why here:** This is the only boundary from SDK/RPC objects into PPOps domain
  state.
- **Assumes:** `(chain, version, public hash, tree, position)` uniquely and
  stably identifies one note. Established by: the constructed tuple and SQLite
  uniqueness constraint; the SDK/protocol coordinate-stability guarantee is
  established by: **nothing found in project source**.
- **Establishes:** Token is lowercased, amount is a decimal string, reference is
  lowercased, and chain/POI axes are explicit.
- **Depended on by:** Database primary key, immutable identity check, intent
  matching, projection totals.

---

**Cross-Function Dependencies:**

- Callee `RpcQuorum.getTransactionReceipt/getBlock` (internal): exact majority
  agreement for receipt/block objects.
- Callee `bucketToPOIStatus` (internal, L61-L82): maps SDK buckets, including
  `Spent + any raw Valid -> SPENDABLE`.
- Callee `POI.getBalanceBucket`, `parseRailgunTokenAddress` (external SDK).
- Caller: `RailgunScanner.scan` only.
- Invariant coupling: fields in the unique ID also participate in
  `ReconciliationService.assertImmutableIdentity` except block data/POI state,
  which may legitimately evolve.

**Open Questions:**

- Can a valid TXO be visible before its receipt reaches every RPC provider? The
  current mapping for absent receipt is `REVERTED`.
- Stability of `txo.txid` and coordinates across SDK rebuild/version behavior is
  an external guarantee.
