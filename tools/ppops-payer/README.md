# PPOps Payer

`ppops-payer` is a minimal, reproducible RAILGUN Wallet SDK harness for the
PPOps mainnet gate. It replaces Railway Wallet in the critical test path; it
does not replace PPOps and it is not a general-purpose wallet.

It shares the PPOps Git repository for reproducibility but remains an
independent package and runtime. Run every command in this README from
`tools/ppops-payer/` on the payer-controlled host.

```text
PPOps request.json -> verify pinned merchant signer -> RAILGUN proof + memo
                  -> self-signed Arbitrum submission -> PPOps reconciliation
```

Current status: the Gate A implementation, unit tests and privacy checks pass.
No mainnet payment is claimed until an operator completes the runbook and PPOps
records `FINALIZED + SPENDABLE + MATCHED -> PAID`.

## Scope

The harness is pinned to:

- Arbitrum One (`42161`);
- native USDC (`0xaf88d065e77c8cc2239327c5edb3a432268e5831`);
- RAILGUN V2 Poseidon Merkle transactions;
- a full payer wallet imported from a 12- or 24-word recovery mnemonic;
- PPOps `PPOpsPaymentDescriptorV1` requests.

It does not expose an HTTP server, UI, account system, swap, custody service or
merchant key path. Gate A submits with a caller-controlled public EVM signer.
That signer is publicly associated with the private transaction. Gate B will
use a RAILGUN Broadcaster only after Gate A succeeds.

## Safety boundary

- Never paste a mnemonic or EVM private key into a CLI argument, URL, issue,
  chat, screenshot or evidence artifact.
- Secret paths must be regular, non-symlink files owned by the current user and
  inaccessible to group/others (`0600`).
- The CLI never returns secret values and reports failures using stable codes,
  not raw SDK/RPC errors.
- `pay-self-signed` requires the exact intent ID and a separate maximum atomic
  amount before it can submit anything.
- Verify the merchant signer through a trusted channel independent of the
  checkout URL.

See [the threat model](docs/THREAT-MODEL.md) before using funds.

## Install and verify

Node.js 22 or newer is required.

```bash
npm ci
npm run verify
```

The pinned RAILGUN dependency tree currently contains low/moderate transitive
audit findings. `npm run verify` fails on high or critical findings. Do not run
`npm audit fix --force`: its proposed package downgrades are breaking changes.

## Initialize

Use a block at or before the payer wallet's first relevant RAILGUN activity.
For the controlled pilot, use the already-recorded native-USDC shield block;
this avoids rescanning all of RAILGUN history without skipping the funded note.

```bash
npm run build

node dist/cli.js init \
  --config ./payer.config.json \
  --creation-block FIRST_PAYER_RAILGUN_BLOCK \
  --from-ppops-config ../../ppops.config.json
```

`init` creates only a new RAILGUN database-encryption key and an ignored local
configuration. It does not copy or generate spending material.

Create these two ignored files with a local editor, then restrict permissions:

```text
secrets/payer.mnemonic
    the full RAILGUN payer recovery mnemonic, one line

secrets/payer.evm-private-key
    a 0x-prefixed 32-byte Arbitrum key holding enough ETH for Gate A gas
```

```bash
chmod 600 ./secrets/payer.mnemonic ./secrets/payer.evm-private-key

node dist/cli.js config-validate --config ./payer.config.json
node dist/cli.js secrets-check --config ./payer.config.json
```

An exported viewing key or a standalone EVM private key cannot reconstruct the
full RAILGUN payer wallet. The recovery mnemonic is required for its private
notes and spending authority.

## Gate A runbook

Follow [docs/GATE-A.md](docs/GATE-A.md). The short sequence is:

```bash
node dist/cli.js sync --config ./payer.config.json

node dist/cli.js request-verify \
  --request http://127.0.0.1:8787/pay/INTENT_ID/request.json \
  --expected-signer PINNED_MERCHANT_SIGNER

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

For native USDC, `100000` atomic units is `0.10 USDC`. Do not reuse an expired
request. `1000000000000000` wei is a maximum of `0.001 ETH`, not an estimate or
target. Choose a bound you independently accept. Compare the locally returned
RAILGUN address with the payer address before approving Gate A.

Immediately before broadcast, the harness persists an owner-only write-ahead
record for the intent. It changes from `SUBMITTING` to `SUBMITTED` after a hash
is returned, and any later attempt to pay the same intent is rejected. Inspect
the record without loading spending keys:

```bash
node dist/cli.js submission-status \
  --config ./payer.config.json \
  --intent-id INTENT_ID
```

If the status remains `SUBMITTING`, treat the result as ambiguous and inspect
the public signer's nonce plus PPOps settlements. Never delete or alter the
journal merely to make a retry pass.

## Evidence interpretation

Gate A proves that Railway Wallet is not required for proof generation,
encrypted `memoText`, submission and PPOps reconciliation. It does not prove
sender unlinkability because the self-signing EVM address is public.

Only after Gate A reaches `PAID` should the same transaction flow be adapted to
Waku/Broadcaster submission for Gate B. Railway Wallet then remains an optional
manual compatibility client, not an operational dependency.

## Development

```bash
npm run typecheck
npm test
npm run privacy:check
npm run build
```

Runtime data, wallet databases, configurations, secrets and local evidence are
ignored by Git.

`sync` and `pay-self-signed` hold an owner-only runtime lock for the full wallet
state. Two payer processes therefore cannot scan or submit concurrently from
the same local wallet cache.
