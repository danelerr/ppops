## `RailgunViewOnlyEngine.start` in `src/railgun/engine.ts` (L202-L262)

**Purpose:** Starts the merchant's RAILGUN engine, loads or creates a wallet from
shareable viewing material, actively checks that it cannot be treated as a full
or signing wallet, and connects the configured provider set.

**Inputs & Assumptions:**

- Constructor-held `config`: parsed operator configuration fixing RAILGUN
  network, deployment block, RPC URLs, storage, polling, and PPOI URLs.
- Constructor-held `dbEncryptionKey` and `shareableViewingKey`: trusted secrets
  loaded by `PPOpsRuntime.create`.
- Implicit: process-global RAILGUN engine/callback state, local filesystem,
  artifact store, LevelDOWN, configured RPC/PPOI services. Established by:
  runtime wiring, local storage paths, and pinned external dependencies.
- Precondition: network name maps to the configured chain and deployment block.
  Constructor enforces both (`L148-L174`).
- Precondition: one process owns these paths. Established for normal root
  callers by `RuntimeLock.acquire` before `start`
  (`src/runtime.ts:L53-L58`).

**Outputs & Effects:**

- Starts the global RAILGUN engine and opens encrypted LevelDOWN.
- Registers UTXO/TXID progress callbacks.
- Loads or creates a persisted view-only wallet identity.
- Exercises two negative authority checks: full-wallet lookup and signing must
  reject with the expected view-only errors.
- Loads a fallback provider or stops all partially initialized resources on
  failure.

---

**Block-by-Block:**

```ts
// L203-L225
if (this.engineStarted) return;
await mkdir(/* DB and artifact roots */);
await startRailgunEngine(/* LevelDOWN, ArtifactStore, PPOI URLs */);
this.engineStarted = true;
setOnUTXOMerkletreeScanCallback(...);
setOnTXIDMerkletreeScanCallback(...);
```

- **What:** Initializes the SDK singleton and persistent/cache callbacks.
- **Why here:** Wallet import/load requires a started engine; state flag is set
  before later work so error cleanup calls `stopRailgunEngine`.
- **Assumes:** SDK lifecycle calls are process-global and compatible with one
  active engine. Established by: the external SDK lifecycle contract; root
  runtime lock limits normal product callers to one, while direct consumers are
  covered by: **nothing found**.
- **Establishes:** Engine state and progress event plumbing exist.
- **Depended on by:** Wallet loading, provider loading, scanner health.

```ts
// L227-L246
this.walletState = await this.loadOrCreateWallet();
const wallet = viewOnlyWalletForID(...);
try { fullWalletForID(...); throw ... } catch (...) { /* exact class message */ }
try { await wallet.sign(...); throw ... } catch (...) { /* exact class message */ }
```

- **What:** Resolves the view-only object, then asserts that full-wallet access
  and direct signing are unavailable.
- **Why here:** Provider/scanning starts only after authority separation is
  exercised.
- **Assumes:** The pinned SDK continues to express these two expected failures
  with matching error messages. Established by: **nothing found in project
  source** beyond dependency pinning (`package.json:L55-L64`).
- **Establishes:** At startup, the SDK does not expose this wallet through the
  tested full-wallet/signing paths.
- **Depended on by:** Product claim that the merchant runtime has no spending
  authority.

```ts
// L248-L257
await withTimeout(loadProvider(this.providerConfig, this.networkName, ...),
  90_000, "RAILGUN provider load");
this.providerLoaded = true;
```

- **What:** Connects the configured weighted RPC fallback through the Wallet
  SDK under a wrapper timeout.
- **Why here:** Scanning cannot proceed without provider state.
- **Assumes:** A wrapper timeout does not cancel the underlying SDK promise;
  `catch` calls stop, but cancellation semantics are external. Established by:
  local `withTimeout` behavior; SDK cancellation is established by: **nothing
  found in project source**.
- **Establishes:** `providerLoaded` only after the load promise completes.
- **Depended on by:** `RailgunScanner.scan` and engine shutdown.

```ts
// L258-L260
} catch (error) {
  await this.stop().catch(() => undefined);
  throw error;
}
```

- **What:** Attempts reverse lifecycle cleanup and preserves the startup error.
- **Why here:** Prevents partially started engine state from being returned.
- **Assumes:** Suppressed cleanup errors need not replace the primary error.
  Established by: the explicit `catch` at `L258-L260`; independent confirmation
  of successful cleanup is established by: **nothing found**.
- **Establishes:** `start` either completes or invokes cleanup.
- **Depended on by:** `PPOpsRuntime.create` cleanup and restart behavior.

---

**Cross-Function Dependencies:**

- Callee `loadOrCreateWallet` (internal, L304-L351): reads existing wallet state
  through the owner-only regular-file helper, compares a key fingerprint/address,
  or creates a view-only wallet and mode-0600 state.
- Callee `artifactStore` (internal, L74-L99): confines SDK artifact paths under
  the configured artifact root.
- Callees from RAILGUN Wallet SDK (external black box for this pass): engine
  lifecycle, wallet creation/load/lookup/signing, provider lifecycle, callbacks.
- Caller: `PPOpsRuntime.create` only in product flow.
- Shared state: global SDK engine/callbacks, LevelDB, artifact files, wallet-state
  JSON, sync progress listeners.

**Open Questions:**

- Whether all SDK spending pathways are covered by the two runtime checks is a
  dependency-interface question not answered by project source.
- SDK behavior if provider load completes after the wrapper timeout remains
  external to this analysis.
