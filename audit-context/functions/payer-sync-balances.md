## `PayerRailgunEngine.syncBalances` in `tools/ppops-payer/src/railgun/engine.ts` (L198-L216)

**Purpose:** Waits for a full payer wallet scan/refresh, then returns native-USDC
amounts partitioned by every SDK `WalletBalanceBucket`.

**Inputs & Assumptions:**

- No explicit parameters; uses loaded full wallet, fixed Arbitrum chain/token,
  provider/PPOI state.
- Precondition: `start` completed; established by normal `withEngine` order and
  enforced locally by the `walletID` getter.
- Precondition: no overlapping scan against the same engine/database. Normal CLI
  calls it once inside a process lock (`tools/ppops-payer/src/cli.ts:L339-L400`);
  exclusivity inside this method for direct/concurrent callers is established
  by: **nothing found**.

**Outputs & Effects:**

- Refreshes SDK balances and waits for wallet scan.
- Returns a string amount for every SDK wallet balance bucket.
- Emits `sync.started`, progress callbacks, and `sync.completed` with only
  spendable amount.
- Wraps failures as `SYNC_FAILED` without returning raw SDK errors.

---

**Block-by-Block:**

```ts
// L199-L205
const walletScan = awaitWalletScan(this.walletID, this.network.chain);
writeEvent("sync.started");
await Promise.all([
  refreshBalances(this.network.chain, [this.walletID]),
  walletScan,
]);
```

- **What:** Starts the SDK completion wait before triggering refresh and waits
  for both.
- **Why here:** The wallet event listener must be active for the refresh that
  completes it.
- **Assumes:** Resolving both promises means balance/PPOI state is ready for all
  bucket queries. Established by: **nothing found in project source**.
- **Establishes:** Later balance summary occurs after SDK completion signals.
- **Depended on by:** Gate A spendable check and operator sync output.

```ts
// L206-L210
const balances = await this.balanceSummary();
writeEvent("sync.completed", {
  spendableAtomic: balances[WalletBalanceBucket.Spendable],
});
return balances;
```

- **What:** Queries fixed native USDC once per bucket and returns canonical
  decimal strings (`balanceSummary`, L230-L245).
- **Why here:** Gate decisions distinguish `Spendable` from pending/blocked
  buckets.
- **Assumes:** SDK enum values and `getBalanceERC20` bucket semantics.
  Established by: the pinned SDK external contract; **nothing found in project
  source** derives those semantics independently.
- **Establishes:** Output is an explicit bucket map, not a single aggregate.
- **Depended on by:** CLI sync display and `paySelfSigned` before proof.

```ts
// L211-L215
} catch (error) {
  throw new SafeFailure("SYNC_FAILED", ... { cause: error });
}
```

- **What:** Reduces any SDK/RPC/PPOI error to a fixed external code.
- **Establishes:** Normal CLI output does not include raw causal message through
  `safeFailureResult`.

---

**Cross-Function Dependencies:**

- RAILGUN SDK `awaitWalletScan`, `refreshBalances`, and `getBalanceERC20` are
  external black boxes in this pass.
- Caller root is payer CLI `sync` and `paySelfSigned`
  (`tools/ppops-payer/src/cli.ts:L364-L409`).
- Shared state: wallet cache and PPOI/balance data.

**Open Questions:**

- Whether this synchronization includes all proof updates required immediately
  before spending is an SDK guarantee not documented in project source.
