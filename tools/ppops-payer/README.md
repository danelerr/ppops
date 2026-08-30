# PPOps Payer

`ppops-payer` is a minimal, reproducible RAILGUN Wallet SDK harness for the
PPOps mainnet gate. It replaces Railway Wallet in the critical test path; it
does not replace PPOps and it is not a general-purpose wallet.

It shares the PPOps Git repository for reproducibility but remains an
independent package and runtime. Run every command in this README from
`tools/ppops-payer/` on the payer-controlled host.

The CLI first unloads the provider, RAILGUN engine, and LevelDB, flushes its
JSON output, and then exits explicitly. This final exit is required because
the SDK prover can leave worker threads referenced after a clean shutdown; it
does not interrupt an active scan, proof, database write, or submission.

```text
PPOps request.json -> verify pinned merchant signer -> RAILGUN proof + memo
                  -> Gate A: self-signed Arbitrum submission
                  -> Gate B: Waku Broadcaster submission
                  -> PPOps reconciliation
```

Current status: Gate A passed on Arbitrum mainnet on 2026-08-30. A bounded
`0.01 USDC` transfer was mined, its output PPOI was submitted by this payer,
and PPOps recorded `FINALIZED + SPENDABLE + MATCHED -> PAID`. This remains a
controlled self-pilot, not external adoption or a production-readiness claim.
Gate B's non-financial Waku preflight also passed on 2026-08-30. Its
value-bearing payment remains pending and must not be inferred from preflight.

## Scope

The harness is pinned to:

- Arbitrum One (`42161`);
- native USDC (`0xaf88d065e77c8cc2239327c5edb3a432268e5831`);
- RAILGUN V2 Poseidon Merkle transactions;
- a full payer wallet imported from a 12- or 24-word recovery mnemonic;
- PPOps `PPOpsPaymentDescriptorV1` requests.

It does not expose an HTTP server, UI, account system, swap, custody service or
merchant key path. Gate A submits with a caller-controlled public EVM signer.
That signer is publicly associated with the private transaction. Gate B uses a
RAILGUN Broadcaster and never loads the optional EVM self-signing key.

## Safety boundary

- Never paste a mnemonic or EVM private key into a CLI argument, URL, issue,
  chat, screenshot or evidence artifact.
- Secret paths must be regular, non-symlink files owned by the current user and
  inaccessible to group/others (`0600`).
- The CLI never returns secret values and reports failures using stable codes,
  not raw SDK/RPC errors.
- `pay-self-signed` requires the exact intent ID and a separate maximum atomic
  amount before it can submit anything. It accepts only a live HTTP(S) request
  and revalidates it after proof generation, immediately before signing.
- `pay-broadcaster` additionally requires an owner-pinned fee-signer trust
  configuration and an independent maximum atomic USDC fee. It requires
  `payment + fee` to be spendable, rechecks the quote/request after proof
  generation and journals nullifiers before Waku submission.
- An ambiguous Broadcaster result is recoverable from the private journal but
  never authorizes an automatic payment retry.
- Verify the merchant signer through a trusted channel independent of the
  checkout URL.

See [the threat model](docs/THREAT-MODEL.md) before using funds.

## Install and verify

Node.js 22 or newer is required.

```bash
npm ci
npm run verify
```

The pinned RAILGUN/Waku dependency tree currently contains 30 low and 10
moderate transitive audit findings. `npm run verify` fails on high or critical
findings. Do not run `npm audit fix --force`: its proposed package downgrades
are breaking changes.

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

Create the ignored mnemonic file with a local editor, then restrict permissions:

```text
secrets/payer.mnemonic
    the full RAILGUN payer recovery mnemonic, one line
```

```bash
chmod 600 ./secrets/payer.mnemonic
node dist/cli.js config-validate --config ./payer.config.json
node dist/cli.js secrets-check --config ./payer.config.json
node dist/cli.js sync --config ./payer.config.json
```

The EVM key is optional and is not used by `sync`, Broadcaster preflight,
`prepare-broadcaster`, `pay-broadcaster` or recovery. Derive it only for the
diagnostic Gate A path:

```bash
node dist/cli.js derive-self-signing-key \
  --config ./payer.config.json \
  --expected-address PINNED_PAYER_EVM_ADDRESS \
  --derivation-index 0
```

`derive-self-signing-key` uses the same Railway-compatible path
`m/44'/60'/0'/0/INDEX`, refuses an unexpected address or an existing different
key, writes the result directly to the owner-only configured file and never
prints the private key. The expected public address must come from the trusted
wallet screen or another independent record, not from PPOps.

An exported viewing key or a standalone EVM private key cannot reconstruct the
full RAILGUN payer wallet. The recovery mnemonic is required for its private
notes and spending authority. After the first successful `sync`, the encrypted
wallet database can be loaded without rereading the mnemonic. Keep an offline
backup, then remove the mnemonic from the operational payer host if desired;
`secrets-check` reports whether it is still required and never deletes it.

## Gate A runbook

Follow [docs/GATE-A.md](docs/GATE-A.md). The short sequence is:

```bash
node dist/cli.js sync --config ./payer.config.json

node dist/cli.js request-verify \
  --request http://127.0.0.1:8787/pay/INTENT_ID/request.json \
  --expected-signer PINNED_MERCHANT_SIGNER

node dist/cli.js prepare-self-signed \
  --config ./payer.config.json \
  --request http://127.0.0.1:8787/pay/INTENT_ID/request.json \
  --expected-signer PINNED_MERCHANT_SIGNER \
  --expected-payer PINNED_PAYER_0ZK_ADDRESS \
  --expected-self-signer PINNED_PAYER_EVM_ADDRESS \
  --max-amount-atomic 100000 \
  --max-gas-cost-wei 1000000000000000

node dist/cli.js pay-self-signed \
  --config ./payer.config.json \
  --request http://127.0.0.1:8787/pay/INTENT_ID/request.json \
  --expected-signer PINNED_MERCHANT_SIGNER \
  --expected-payer PINNED_PAYER_0ZK_ADDRESS \
  --expected-self-signer PINNED_PAYER_EVM_ADDRESS \
  --max-amount-atomic 100000 \
  --max-gas-cost-wei 1000000000000000 \
  --confirm-intent INTENT_ID

node dist/cli.js finalize-poi \
  --config ./payer.config.json \
  --intent-id INTENT_ID \
  --expected-payer PINNED_PAYER_0ZK_ADDRESS
```

For native USDC, `100000` atomic units is `0.10 USDC`. Do not reuse an expired
request. `1000000000000000` wei is a maximum of `0.001 ETH`, not an estimate or
target. Choose a bound you independently accept. Compare the locally returned
RAILGUN address with the payer address before approving Gate A.

`prepare-self-signed` runs sync, gas estimation, proof generation, transaction
population, all bounds and the final live-request recheck, but does not sign,
journal or broadcast a transaction. It returns `paymentSubmitted: false`. The
subsequent payment intentionally repeats proof preparation against fresh state.

After the chain receipt is `MINED`, `finalize-poi` resolves that exact journaled
transaction through the payer's decrypted sent-commitment history, generates
the output PPOI and requires `ProofSubmitted` or `Valid` acknowledgement. It
does not submit another EVM transaction or spend additional USDC. An optional
`--expected-railgun-txid` cross-check may be supplied from independent receiver
evidence.

The harness owns synchronization explicitly: it pauses the SDK listener poller,
awaits `refreshBalances`, and reads the resulting PPOI buckets directly. It does
not combine historical refresh with `awaitWalletScan`, whose deferred-event
semantics can otherwise leave a finite CLI waiting for an unrelated later scan.

Immediately before broadcast, the harness signs locally, computes the exact
transaction hash and persists that hash plus nonce in an owner-only write-ahead
record. It changes from `SUBMITTING` to `SUBMITTED` after the RPC accepts the raw
transaction, then to `MINED` or `REVERTED` after a receipt. Any later attempt to
pay the same intent is rejected. Inspect the record without loading spending
keys:

```bash
node dist/cli.js submission-status \
  --config ./payer.config.json \
  --intent-id INTENT_ID
```

If the status remains `SUBMITTING` or `SUBMITTED`, use its precomputed public
transaction hash plus PPOps state to resolve the result. A two-minute receipt
timeout returns `PENDING`; it is not permission to retry. Never delete or alter
the journal merely to make a retry pass.

## Gate B runbook

Follow [docs/GATE-B.md](docs/GATE-B.md). Gate B first creates an ignored,
owner-only trust file whose fee signers were verified out of band. Connectivity
can then be tested without opening the wallet:

```bash
node dist/cli.js broadcaster-preflight \
  --config ./payer.config.json \
  --broadcaster-config ./broadcaster.config.json
```

For a fresh request, `prepare-broadcaster` performs sync, quote selection, fee
calculation, proof generation, population and final request/quote validation
without sending. `pay-broadcaster` requires exact intent, payer, amount and
USDC-fee bounds. It writes a recoverable nullifier reservation before Waku and
requires a configured-provider majority to agree on the receipt before marking
the transaction mined. Use
`recover-broadcaster`, never a blind retry, after an ambiguous result.

The controlled 2026-08-30 preflight found at least five LightPush and at least
five Filter peers and a ready quote with observed reliability between `0.84`
and `1`. No proof or payment was created.

## Evidence interpretation

Gate A proves that Railway Wallet is not required for proof generation,
encrypted `memoText`, submission and PPOps reconciliation. It does not prove
sender unlinkability because the self-signing EVM address is public.

The controlled 2026-08-30 run used a `0.001 ETH` gas ceiling. The populated
maximum was `54267840000000` wei, the transaction mined once, PPOI moved from
`MissingExternalPOI` through `ProofSubmitted` to `Valid`, and the signed
metadata-minimal mainnet report passed restart, restore and webhook-deduplication
checks. Direct identifiers remain in private operator evidence only.

Gate B is now implemented behind separate amount/fee/intent confirmation and a
write-ahead recovery journal. Only its connectivity preflight has run; a real
Broadcaster payment and reconciliation are still required. Railway Wallet
remains an optional manual compatibility client, not an operational dependency.

## Development

```bash
npm run typecheck
npm test
npm run privacy:check
npm run build
```

Runtime data, wallet databases, configurations, secrets and local evidence are
ignored by Git.

Every command that opens the full wallet—including `sync`, both preparation and
payment modes, Broadcaster recovery and `finalize-poi`—holds an owner-only
runtime lock. Two payer processes therefore cannot scan, submit or generate
PPOI concurrently from the same local wallet cache.
