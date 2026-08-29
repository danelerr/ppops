# Gate A: direct SDK self-signed payment

Status: implementation ready; live evidence pending.

## Objective

Demonstrate one real Arbitrum native-USDC private transfer with the exact PPOps
memo without Railway Wallet in the execution path:

```text
full payer wallet -> official RAILGUN Wallet SDK -> public self-signer
                  -> Arbitrum -> PPOps view-only scanner
                  -> FINALIZED + SPENDABLE + MATCHED -> PAID
```

Gate A diagnoses protocol/SDK viability. The public self-signer deliberately
sacrifices sender unlinkability so Broadcaster reliability is not mixed into
the first test.

## Preconditions

- PPOps preflight passes on Arbitrum One.
- The payer has native USDC in RAILGUN's `Spendable` bucket.
- The payer recovery mnemonic and a gas-funded Arbitrum EVM key exist only in
  owner-only local files.
- The expected merchant EIP-712 signer is pinned through a trusted channel.
- The payer creation block is at or before its first relevant RAILGUN note.
- The payment intent is fresh and remains `OPEN` with zero received/pending
  amount.

## 1. Verify the harness

From the unified repository root, enter the independent payer package:

```bash
cd tools/ppops-payer
npm ci
npm run verify
npm run build
node dist/cli.js config-validate --config ./payer.config.json
node dist/cli.js secrets-check --config ./payer.config.json
```

Expected: every command succeeds; no key, mnemonic, RPC credential or raw SDK
error appears in output.

## 2. Import and synchronize once

```bash
node dist/cli.js sync --config ./payer.config.json
```

The first run imports the full RAILGUN wallet into an encrypted local LevelDB.
Subsequent runs load that database without rereading the mnemonic. Progress is
emitted as structured events instead of a frozen percentage. The command must
finish with a `Spendable` native-USDC balance at or above the planned amount.

Stop if the returned `railgunAddress` is not the expected payer address. Do not
attempt to repair an identity mismatch by changing wallet state in place; use a
separate clean data directory and re-check the creation block and mnemonic.

## 3. Create and verify a fresh PPOps request

Start PPOps and create a new intent only after the payer is spendable. Use an
expiry long enough for proof generation and finality.

```bash
node dist/cli.js request-verify \
  --request http://127.0.0.1:8787/pay/INTENT_ID/request.json \
  --expected-signer PINNED_MERCHANT_SIGNER
```

Expected: `descriptorValid: true`, the exact chain/token/amount, and
`paymentSubmitted: false`.

## 4. Submit with explicit bounds

For a `0.10 USDC` pilot:

```bash
node dist/cli.js pay-self-signed \
  --config ./payer.config.json \
  --request http://127.0.0.1:8787/pay/INTENT_ID/request.json \
  --expected-signer PINNED_MERCHANT_SIGNER \
  --expected-payer PINNED_PAYER_0ZK_ADDRESS \
  --expected-self-signer PINNED_PAYER_EVM_ADDRESS \
  --max-amount-atomic 100000 \
  --max-gas-cost-wei 1000000000000000 \
  --confirm-intent INTENT_ID
```

The harness validates the signed request, payer and self-signer identities,
amount limit, private spendable balance, explicit maximum gas cost, public gas
balance, proxy destination and zero ETH value before sending. The example gas
bound is `0.001 ETH`; choose a limit you independently accept. A successful
result includes a public Arbitrum transaction hash and the explicit warning
`public-self-signer-linked`.

Do not rerun blindly after an ambiguous RPC response. First inspect the public
signer's nonce and PPOps settlements; a submitted transaction may exist even if
the client did not receive the response. The local write-ahead journal blocks
reuse of the intent; inspect it with `submission-status --config
./payer.config.json --intent-id INTENT_ID`. `SUBMITTING` without a hash is an
ambiguous state, not permission to delete the record and retry.

## 5. Complete PPOps evidence

Wait for PPOps to record:

```text
chainStatus = FINALIZED
poiStatus   = SPENDABLE
matchStatus = MATCHED
intent      = PAID
```

Then follow PPOps `docs/MAINNET-GATE.md` for restart, webhook-deduplication and
isolated-restore evidence. Redact payer/merchant addresses, transaction hashes,
references, RPC credentials and local invoice identifiers from public reports.

## Decision

- Success: keep RAILGUN, remove Railway from the critical path, then implement
  Gate B with a Waku Broadcaster.
- Proof/reconciliation succeeds but self-submission has RPC problems: keep the
  rail and harden provider selection separately.
- Direct SDK import/sync/proof/memo repeatedly fails with reproducible evidence:
  reassess RAILGUN as PPOps' initial rail.
