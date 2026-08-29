## `RpcQuorum.consensusValue` / `consensusHeight` in `src/railgun/rpc-quorum.ts` (L132-L176)

**Purpose:** Supplies the scanner with provider-agreed chain identity, receipt,
block, latest height, and finalized height rather than trusting a single RPC.

**Inputs & Assumptions:**

- Constructor config: expected chain ID, one or more RPC URLs, timeout, allowed
  height lag; mainnet schema requires distinct origins and at least two
  (`src/config.ts:L192-L202`).
- `operation`: internal callback selecting the RPC method.
- `keyFor`: internal canonicalizer for exact-value grouping.
- External provider responses/failures: untrusted.
- Precondition: providers are intended to represent sufficiently independent
  observations. Organizational independence is established by: **nothing
  found**; only unique URL origins are enforced.

**Outputs & Effects:**

- `consensusValue` returns one value only when an exact key has strict-majority
  support among all configured providers.
- `consensusHeight` returns the lowest base of the first sorted cluster within
  `maxBlockLag` that reaches strict majority.
- Failed/timed-out responses are ignored; insufficient agreement throws.
- Provider objects persist until `close` destroys them.

---

**Block-by-Block:**

```ts
// L137-L152
const results = await Promise.allSettled(
  this.providers.map((provider) => timeout(operation(provider), timeoutMs)),
);
/* group fulfilled results by keyFor */
const winner = [...groups.values()].sort((l, r) => r.length - l.length)[0];
if (!winner || winner.length < this.quorum) throw ...;
return winner[0];
```

- **What:** Executes every provider concurrently, groups exact canonical values,
  and requires a strict majority based on total configured provider count.
- **Why here:** One unavailable or dissenting provider cannot decide a value
  when the remaining group reaches quorum.
- **Assumes:** `keyFor` includes every field downstream logic relies on.
  Receipt key includes hash/block/blockHash/index/status (`L44-L48`); block key
  includes number/hash/timestamp (`L39-L42`). Established by: these explicit
  canonicalizers; protocol completeness beyond them is established by:
  **nothing found**.
- **Establishes:** Returned exact-value data has configured strict-majority
  agreement.
- **Depended on by:** Chain ID verification, receipt status, block timestamp/hash.

```ts
// L159-L175
const heights = fulfilledSafeNonnegativeHeights.sort(...);
for (let start = 0; start < heights.length; start += 1) {
  const base = heights[start];
  const cluster = heights.filter((height) => height >= base &&
    height - base <= maxBlockLag);
  if (cluster.length >= this.quorum) return base;
}
throw ...;
```

- **What:** Accepts bounded height skew and selects the conservative lower
  boundary of a quorum cluster.
- **Why here:** Exact equality for moving heads would make normal provider lag
  fail; the lower height avoids advancing to the cluster's freshest report.
- **Assumes:** `maxBlockLag` is appropriate for both latest and finalized tags.
  Established by: validated operator configuration; its operational rationale
  is established by: **nothing found** in this function.
- **Establishes:** A returned height is reported by one provider and has a quorum
  of observations no more than the configured lag above it.
- **Depended on by:** Confirmation counts and finalized-block comparison.

---

**Cross-Function Dependencies:**

- Caller `chainContext` first calls `assertChainId`, then obtains latest and
  optional finalized heights; it additionally calls `getBlock(finalizedHeight)`
  for exact block agreement (`L68-L104`).
- Callers `getTransactionReceipt` and `getBlock` use exact canonical groups
  (`L106-L122`).
- Callee ethers `JsonRpcProvider` (external dependency) performs JSON-RPC.
- Shared state: `chainVerified` caches one successful chain-ID quorum for the
  lifetime of this object (`L53`, `L87-L104`).

**Open Questions:**

- Operator guarantees about independent ownership/network paths of RPC origins
  are not encoded.
- The same `maxBlockLag` is used for latest and finalized height; intended
  operational rationale is outside this function.
