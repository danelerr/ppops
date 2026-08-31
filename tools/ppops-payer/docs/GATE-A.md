# Gate A: direct SDK self-signed payment

Status: **PASS** on Arbitrum mainnet, 2026-08-30. A later isolated Gate B
value-bearing Broadcaster payment also passed; external adoption remains
pending.

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
- The payer recovery mnemonic is available for the first import and the
  independently verified, derived Arbitrum EVM key has enough ETH for Gate A.
  Both files are owner-only; the mnemonic may be removed after import.
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
node dist/cli.js derive-self-signing-key \
  --config ./payer.config.json \
  --expected-address PINNED_PAYER_EVM_ADDRESS \
  --derivation-index 0
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

After the first successful sync, keep the mnemonic backup offline and remove it
from the payer host if desired. `secrets-check` will report
`mnemonicRequired: false`; PPOps never receives this material.

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

## 4. Prepare without broadcast

Run the full SDK path once without signing or broadcasting:

```bash
node dist/cli.js prepare-self-signed \
  --config ./payer.config.json \
  --request http://127.0.0.1:8787/pay/INTENT_ID/request.json \
  --expected-signer PINNED_MERCHANT_SIGNER \
  --expected-payer PINNED_PAYER_0ZK_ADDRESS \
  --expected-self-signer PINNED_PAYER_EVM_ADDRESS \
  --max-amount-atomic 10000 \
  --max-gas-cost-wei 1000000000000000
```

Expected: `mode: prepare-only`, `proofGenerated: true` and
`paymentSubmitted: false`. This validates sync, proof, population, live-request
freshness and gas bounds without reserving the intent or moving funds.

Controlled result on 2026-08-30: a `0.01 USDC` request completed this command in
7.8 seconds, confirmed sufficient spendable native USDC, generated the proof and
bounded the populated transaction at `56190171212000` wei maximum gas cost. No
submission-journal record was created and no transaction was broadcast. This
is preparation evidence, not Gate A payment evidence.

A final repeat after cleanup failures were made fatal completed in 10.7 seconds
at `54286600000000` wei maximum gas cost and again returned `recorded: false`.
These live values demonstrate the bound; they are not future fee estimates.

## 5. Submit with explicit bounds

For the prepared `0.01 USDC` pilot, set the independently accepted amount
ceiling to the same `0.01 USDC`:

```bash
node dist/cli.js pay-self-signed \
  --config ./payer.config.json \
  --request http://127.0.0.1:8787/pay/INTENT_ID/request.json \
  --expected-signer PINNED_MERCHANT_SIGNER \
  --expected-payer PINNED_PAYER_0ZK_ADDRESS \
  --expected-self-signer PINNED_PAYER_EVM_ADDRESS \
  --max-amount-atomic 10000 \
  --max-gas-cost-wei 1000000000000000 \
  --confirm-intent INTENT_ID
```

The harness validates the signed request, payer and self-signer identities,
amount limit, private spendable balance, explicit maximum gas cost, public gas
balance, proxy destination and zero ETH value before sending. After generating
the proof it reloads the live request and refuses any status or field change.
The example gas bound is `0.001 ETH`; choose a limit you independently accept.
A successful result includes a public Arbitrum transaction hash, receipt status
and the explicit warning `public-self-signer-linked`.

Do not rerun blindly after an ambiguous RPC response. The payer computes and
persists the transaction hash and nonce before broadcast, then records
`SUBMITTED`, `MINED` or `REVERTED`. Inspect it with `submission-status --config
./payer.config.json --intent-id INTENT_ID` and compare that hash with PPOps and
Arbitrum. `SUBMITTING`, `SUBMITTED` or a returned `PENDING` receipt is not
permission to delete the record and retry.

## 6. Finalize the output PPOI

RAILGUN requires the spending wallet to prove the provenance of the newly
created outputs. A mined transfer can therefore be visible to PPOps while its
receiver output is still `MissingExternalPOI`. Finalize only the exact mined
journal record:

```bash
node dist/cli.js finalize-poi \
  --config ./payer.config.json \
  --intent-id INTENT_ID \
  --expected-payer PINNED_PAYER_0ZK_ADDRESS
```

Optionally add `--expected-railgun-txid` with an independently observed TXID.
The command performs no second payment; it synchronizes the full payer wallet,
generates the spent-output PPOI and requires node acknowledgement.

## 7. Complete PPOps evidence

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

Controlled result: one `0.01 USDC` transfer mined once with a populated maximum
gas cost of `54267840000000` wei under the approved `0.001 ETH` ceiling. PPOps
first recorded `CONFIRMED + PENDING + MATCHED`, then reached
`FINALIZED + SPENDABLE + MATCHED -> PAID` after the payer submitted PPOI. The
three-phase signed report is `artifacts/mainnet-gate-report.json`.

## Decision

- Success: keep RAILGUN, remove Railway from the critical path, then complete
  the implemented Waku/Broadcaster path in [Gate B](GATE-B.md).
- Proof/reconciliation succeeds but self-submission has RPC problems: keep the
  rail and harden provider selection separately.
- Direct SDK import/sync/proof/memo repeatedly fails with reproducible evidence:
  reassess RAILGUN as PPOps' initial rail.
