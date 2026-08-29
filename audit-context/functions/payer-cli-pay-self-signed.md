## `paySelfSigned` in `tools/ppops-payer/src/cli.ts` (L375-L421)

**Purpose:** Orchestrates Gate A with explicit human/operator bounds before it
hands full-wallet and EVM-signing authority to the transfer function.

**Inputs & Assumptions:**

- CLI options: untrusted local strings for config/request/signer/payer/gas/amount/
  intent confirmation.
- Local config and secret files: semi-trusted operator state validated by
  `loadConfig`/`readSecret`.
- Payment request: untrusted remote/file JSON validated by `verifiedRequest`.
- Precondition: operator independently chose all expected identities and caps.
  Their provenance is established by: **nothing found** in code.

**Outputs & Effects:**

- Before spending, requires exact request ID confirmation, explicit maximum
  amount, config/secrets, exact payer 0zk address, wallet sync, exact EVM signer,
  and explicit gas cap.
- Starts/stops one payer engine around the operation.
- On success prints transaction hash, signer, bounded maximum gas cost, and an
  explicit public-linkability warning.
- May submit one irreversible mainnet transaction through the callee.

---

**Block-by-Block:**

```ts
// L375-L393
assertAllowed(options, [/* exact option set */]);
const request = await verifiedRequest(options);
if (confirmIntent !== request.id) throw ...;
if (!positive(maxAmount) || BigInt(request.amountAtomic) > BigInt(maxAmount)) throw ...;
```

- **What:** Rejects unknown options, authenticates the payment snapshot, and
  requires exact intent and amount confirmations.
- **Why here:** No payer secret or wallet engine is loaded before the payment
  request and human bounds pass.
- **Assumes:** Operator reviewed the supplied expected signer/intent/limit.
  Established by: explicit CLI inputs and equality/cap checks at `L375-L393`;
  independent human review is established by: **nothing found** in code.
- **Establishes:** Requested payment was within explicit amount authority at this
  time.
- **Depended on by:** Secret load/engine start.

```ts
// L394-L400
const config = await loadConfig(...);
const secrets = await loadRuntimeSecrets(config, true);
...
const result = await withEngine(config, secrets, async (engine) => {
  assertExpectedPayerAddress(engine.railgunAddress, expectedPayer);
  await engine.syncBalances();
```

- **What:** Loads owner-only credentials, starts the full wallet, checks exact
  payer identity, and synchronizes before execution.
- **Why here:** Prevents a valid mnemonic for the wrong 0zk wallet from spending
  under this invocation.
- **Assumes:** The payer runtime lock excludes normal local CLI engine use, but
  another wallet/process outside that lock does not consume the notes while
  sync/proof runs. Established by: **nothing found** for external actors.
- **Establishes:** Loaded wallet address equals explicit payer and its cache was
  synchronized before transfer function starts.
- **Depended on by:** Private-balance check/proof.

```ts
// L401-L409
return sendSelfSignedTransfer({
  config, engine, request, dbEncryptionKey, evmPrivateKey,
  expectedSelfSigner, maxGasCostWei,
});
```

- **What:** Passes only verified request and explicit execution parameters to
  the financial side-effect function.
- **Why here:** All orchestration gates precede submission.
- **Assumes:** Merchant status and received/pending totals remain unchanged; the
  request is not reloaded here. The callee separately rechecks local expiry
  immediately before its submission reservation. Continued merchant-state
  freshness is established by: **nothing found**.
- **Establishes:** The transfer function receives fixed inputs from one verified
  snapshot.

```ts
// L411-L420
output({ ok: true, mode: "self-signed", intentId, amountAtomic,
  transactionHash, selfSigner, maxGasCostWei,
  privacyWarning: "public-self-signer-linked" });
```

- **What:** Emits reproducible Gate A result and linkability disclosure.
- **Why here:** Output occurs only after ethers returns a transaction response.
- **Assumes:** Transaction hash is submission evidence, not mining/finality
  evidence. Established by: the callee returning after ethers submission and
  before any receipt wait
  (`tools/ppops-payer/src/railgun/self-signed-transfer.ts:L241-L251`).
- **Establishes:** No mnemonic/private key is intentionally returned.

---

**Cross-Function Dependencies:**

- Callee `verifiedRequest` -> request loader/verifier (internal).
- Callee `loadConfig/loadRuntimeSecrets/readSecret` (internal): profile and
  secret file policy.
- Callee `withEngine` (internal): acquires a wallet-path PID/token lock before
  engine construction, then stops the engine and releases the lock through
  nested `finally` blocks (`tools/ppops-payer/src/cli.ts:L339-L362`).
- Callee `assertExpectedPayerAddress` (internal): exact valid 0zk equality.
- Callee `sendSelfSignedTransfer` (internal plus SDK/ethers): financial effect;
  separate record.
- Caller: payer CLI dispatch `case "pay-self-signed"` (`L423-L451`).

**Open Questions:**

- The callee rechecks expiry but does not refetch merchant status or payment
  totals after long-running sync/proof.
- The transfer callee persists a local `SUBMITTING` reservation; the operator
  interpretation of an ambiguous reservation is outside this orchestration
  function.
