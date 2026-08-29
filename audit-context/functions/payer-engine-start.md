## `PayerRailgunEngine.start` in `tools/ppops-payer/src/railgun/engine.ts` (L124-L170)

**Purpose:** Starts a full-authority payer RAILGUN engine, loads/imports its wallet
and prover, connects providers, and emits non-secret readiness/progress state.

**Inputs & Assumptions:**

- Constructor config: fixed Arbitrum/native-USDC profile, wallet creation block,
  RPC/PPOI paths and storage.
- Constructor DB key and optional mnemonic: trusted local secrets.
- Implicit: RAILGUN SDK singleton, LevelDOWN, snarkjs prover, artifacts, RPC/PPOI.
  Established by: imports and pinned package versions in the payer manifest.
- Precondition: no concurrent normal payer CLI process opens the same persistent
  paths. Established by `withEngine` acquiring `PayerRuntimeLock` before engine
  construction (`tools/ppops-payer/src/cli.ts:L339-L362`). Direct library callers
  must establish the same precondition themselves.
- Precondition: first import receives the mnemonic for the wallet containing the
  intended private funds; address equality is checked later by the CLI explicit
  gate. Independent mnemonic intent is established by: **nothing found** in this
  function.

**Outputs & Effects:**

- Starts external engine, opens/creates encrypted full-wallet DB, installs proof
  and scan callbacks, loads/creates wallet-state JSON, installs prover, and loads
  providers.
- On error, attempts to stop/unload and returns fixed `ENGINE_START_FAILED` to
  CLI boundary through `SafeFailure`.
- Holds mnemonic (only on first import path), DB key, and full-wallet authority
  in process memory.

---

**Block-by-Block:**

```ts
// L125-L146
if (this.engineStarted) return;
/* mkdir DB/artifacts */
await startRailgunEngine(/* full engine with PPOI URLs */);
this.engineStarted = true;
this.installCallbacks();
getProver().setSnarkJSGroth16(groth16 ...);
```

- **What:** Initializes persistence, SDK singleton, safe progress output, and
  local proof implementation.
- **Why here:** Wallet import/load and proof operations need these components.
- **Assumes:** Caller holds exclusive access to these paths. Normal CLI flow
  establishes it through the PID/token lock; direct engine consumers are
  established by: **nothing found**.
- **Establishes:** Engine/prover/callback prerequisites are registered.
- **Depended on by:** Wallet load/import, sync, proof generation.

```ts
// L147-L149
this.walletState = await this.loadOrCreateWallet();
fullWalletForID(this.walletState.walletID);
assertValidRailgunAddress(this.walletState.railgunAddress);
```

- **What:** Requires full-wallet lookup to succeed and validates the persisted
  address syntax.
- **Why here:** Payer must have spending authority; this is the inverse of the
  merchant engine's negative authority checks.
- **Assumes:** If loading existing wallet state, the encrypted DB belongs to the
  intended payer. Established by: persisted address equality at `L280-L283`;
  CLI separately compares to expected payer before spending.
- **Establishes:** Wallet ID resolves to a full SDK wallet with valid 0zk address.
- **Depended on by:** Sync/spend methods.

```ts
// L150-L163
await withTimeout(loadProvider(...), 90_000, ...);
this.providerLoaded = true;
writeEvent("engine.ready", { network, creationBlock });
```

- **What:** Loads configured weighted fallback providers and reports only public
  profile fields.
- **Why here:** Sync starts only after wallet/provider readiness.
- **Assumes:** Wrapper timeout/cancellation behavior of external SDK.
  Established by: local timeout wrapper and SDK promise behavior; cancellation
  of the underlying SDK call is established by: **nothing found**.
- **Establishes:** Successful return has provider-loaded flag and wallet state.
- **Depended on by:** `syncBalances` and transfer proof path.

```ts
// L164-L168
} catch (error) {
  await this.stop().catch(() => undefined);
  throw new SafeFailure("ENGINE_START_FAILED", ... { cause: error });
}
```

- **What:** Cleans partial lifecycle and masks raw error at public failure
  boundary.
- **Establishes:** Callers receive a fixed classification without logging the
  causal error content.

---

**Cross-Function Dependencies:**

- Callee `loadOrCreateWallet` (internal, L267-L305): owner-only persisted state,
  creation-block consistency, full wallet load or mnemonic import.
- Callee `createArtifactStore` (internal): confines SDK paths under artifact root
  (`tools/ppops-payer/src/railgun/artifacts.ts:L16-L41`).
- RAILGUN Wallet SDK, LevelDOWN, and snarkjs are external dependencies.
- Caller `withEngine` acquires the payer runtime lock and guarantees `stop` then
  lock release in nested `finally` blocks
  (`tools/ppops-payer/src/cli.ts:L339-L362`).
- Shared state: global SDK/prover/callbacks, LevelDB, wallet JSON, in-memory
  secrets.

**Open Questions:**

- Direct library construction of `PayerRailgunEngine` is not forced to acquire
  `PayerRuntimeLock`; the CLI path does.
- Creation-block provenance and recovery documentation are operator inputs.
