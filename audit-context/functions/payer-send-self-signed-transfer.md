## `sendSelfSignedTransfer` in `tools/ppops-payer/src/railgun/self-signed-transfer.ts` (L88-L260)

**Purpose:** Executes the single Gate A financial effect: generate/populate a
private native-USDC RAILGUN transfer with the verified PPOps memo, then submit it
using an explicitly identified public EVM signer under explicit balance/gas/
destination/value bounds.

**Inputs & Assumptions:**

- `config`: validated fixed payer profile and provider set.
- `engine`: started, full-authority payer engine already synchronized.
- `request`: output of `verifyPaymentRequest`.
- `dbEncryptionKey`, `evmPrivateKey`: trusted local secrets.
- `expectedSelfSigner`, `maxGasCostWei`: explicit operator CLI bounds.
- Precondition: engine wallet equals explicit expected payer. Established by
  `paySelfSigned` immediately before this call (`tools/ppops-payer/src/cli.ts:L397-L401`).
- Precondition: request was verified earlier. This function rechecks expiry
  immediately before reservation/send; live merchant status/totals are not
  fetched again and are established by: **nothing found**.

**Outputs & Effects:**

- Reads private spendable USDC and public EVM gas balance.
- Calls RAILGUN gas estimation, proof generation, and transaction population.
- Requires populated destination to equal the network RAILGUN proxy and ETH
  value to be zero.
- Refuses an existing journal record and writes a `SUBMITTING` reservation
  before the external submission call.
- Sends one Type-2 Arbitrum transaction and returns hash, self-signer, and
  maximum bounded gas cost; then records the hash as `SUBMITTED`.
- Does not wait for receipt/finality.

---

**Block-by-Block:**

```ts
// L97-L115
const amount = BigInt(request.amountAtomic);
const derivedSelfSigner = assertExpectedSelfSigner(evmPrivateKey, expectedSelfSigner);
const gasCostLimit = parseGasCostLimit(maxGasCostWei);
const submissionJournal = new SubmissionJournal(...);
await submissionJournal.assertUnused(request.id);
const spendable = await engine.spendableBalance();
if (spendable < amount) throw ...;
const providerContext = await selectProvider(config, evmPrivateKey);
```

- **What:** Fixes amount, verifies EVM key identity, parses gas authority, checks
  private funds, and chooses the first provider with correct chain/fee data.
- **Why here:** No proof work begins without identity/fund/cap prerequisites.
- **Assumes:** Another process/wallet does not spend the selected private notes
  after this check. Established by: **nothing found**.
- **Establishes:** At check time, private spendable covers amount and selected
  provider reports Arbitrum/fee data; no prior local record exists for the
  intent.
- **Depended on by:** Proof and submission.

```ts
// L117-L148
const recipients = [{ tokenAddress: PAYER_TOKEN_ADDRESS, amount,
  recipientAddress: request.recipient }];
const estimate = await gasEstimateForUnprovenTransfer(
  version, Arbitrum, walletID, dbKey, request.memo, recipients, ...);
```

- **What:** Constructs one fixed ERC-20 recipient and obtains SDK gas estimate
  using the exact verified memo.
- **Why here:** The same inputs are reused by proof/population.
- **Assumes:** SDK estimator binds estimate to these inputs; project code cannot
  inspect that internal contract. Established by: the pinned RAILGUN Wallet SDK;
  **nothing found in project source** independently checks that binding.
- **Establishes:** `estimatedGas` returned for requested private transfer.
- **Depended on by:** Calculated gas limit and maximum cost.

```ts
// L150-L175
await generateTransferProof(
  version, Arbitrum, walletID, dbKey, false, request.memo,
  recipients, [], ..., true, ..., progressCallback,
);
```

- **What:** Generates the RAILGUN transfer proof and emits bounded progress.
- **Why here:** Population requires a completed proof.
- **Assumes:** SDK proof is bound to wallet/version/network/memo/recipient/amount.
  Established by: **nothing found in project source**.
- **Establishes:** External SDK reports proof generation success for those
  arguments.
- **Depended on by:** `populateProvedTransfer`.

```ts
// L177-L197
const boundedGasLimit = calculateGasLimit(estimatedGas);
const maxGasCostWei = assertGasCostWithinLimit(boundedGasLimit, maxFeePerGas, cap);
const gasBalance = await provider.getBalance(derivedSelfSigner);
if (gasBalance < maxGasCostWei) throw ...;
```

- **What:** Converts estimate to SDK gas limit, bounds worst-case fee product,
  and checks public ETH balance.
- **Why here:** Submission cannot exceed the explicit calculated fee cap in the
  constructed request.
- **Assumes:** Provider's fee and balance reports are accurate; send path does
  not quorum them. Established by: one selected RPC at `L49-L75`; an independent
  provider check is established by: **nothing found** on this path.
- **Establishes:** Reported ETH balance covers `gasLimit * maxFeePerGas`, and this
  product is within operator cap.
- **Depended on by:** Final transaction fields.

```ts
// L198-L230
populated = await populateProvedTransfer(/* same memo/recipients/gas */);
if (!populated.transaction.to || !populated.transaction.data) throw ...;
if (getAddress(to) !== getAddress(engine.network.proxyContract)) throw ...;
if (value && BigInt(value) !== 0n) throw ...;
```

- **What:** Obtains SDK transaction then locally constrains completeness,
  destination, and native value.
- **Why here:** External SDK output is checked before private key submission.
- **Assumes:** Calldata faithfully encodes the intended proof/recipient/memo.
  Calldata decoding/comparison is established by: **nothing found** in project
  source.
- **Establishes:** Transaction targets expected proxy, has calldata, and sends
  zero ETH value.
- **Depended on by:** EVM signer.

```ts
// L232-L251
const transaction = { ...populated.transaction, from: undefined,
  chainId: PAYER_CHAIN_ID, type: Type2, gasLimit: boundedGasLimit,
  maxFeePerGas, maxPriorityFeePerGas };
assertRequestStillOpen(request.expiresAt);
await submissionJournal.reserve(request, derivedSelfSigner);
const response = await signer.sendTransaction(transaction);
writeEvent("transfer.submitted", { transactionHash: response.hash });
await submissionJournal.markSubmitted(request.id, response.hash);
return { transactionHash: response.hash, ... };
```

- **What:** Overrides authority-relevant chain/gas fields, rechecks expiry,
  durably reserves the intent, submits with the verified EVM signer, and records
  the returned hash.
- **Why here:** The irreversible external effect is last, after all local gates.
- **Assumes:** Merchant live status/totals are unchanged because only local
  expiry is rechecked. Ethers/selected RPC submission semantics provide a hash
  but not a mined receipt. Established by: **nothing found** for refreshed
  merchant state, and the external ethers/RPC contract for submission response.
- **Establishes:** Before send, one local intent reservation exists. On complete
  success, the provider accepted/broadcast a signed transaction according to
  ethers and its hash is journaled; no chain-finality guarantee.
- **Depended on by:** CLI Gate A output and later PPOps reconciliation.

```ts
// L257-L259
} finally {
  await providerContext.provider.destroy();
}
```

- **What:** Destroys selected submission provider after any post-selection path.
- **Establishes:** Provider resource cleanup is attempted.

---

**Cross-Function Dependencies:**

- Internal guards validate signer, gas cap, and pre-reservation expiry
  (`tools/ppops-payer/src/execution-guards.ts:L15-L68`).
- `selectProvider` checks each RPC's chain/fee data and selects the first
  acceptable provider (`L49-L75`); it is not the merchant scanner's quorum.
- RAILGUN Wallet SDK proof/estimate/population and ethers signing/submission are
  external dependencies.
- Callee `SubmissionJournal` persists a one-intent reservation and optional
  transaction hash; separate record.
- Caller: payer `paySelfSigned` only.
- Shared state: payer private notes/SDK proof cache, public EVM nonce/balance,
  public chain.

**Open Questions:**

- No decoded-calldata comparison against request fields exists in project code;
  proof/population binding remains an SDK contract.
- A submission or journal-update error leaves `SUBMITTING`; the meaning and
  external reconciliation of that ambiguous state are operator concerns.
- The function rechecks expiry, but not live merchant status/received/pending,
  immediately before send.
