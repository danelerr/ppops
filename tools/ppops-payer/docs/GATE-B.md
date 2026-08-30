# Gate B: Waku Broadcaster payment

Status: **CONNECTIVITY PREFLIGHT PASS; VALUE-BEARING GATE PENDING** on Arbitrum
mainnet, 2026-08-30.

Gate B replaces Gate A's public payer EVM signer with a RAILGUN Broadcaster. It
does not change PPOps, the signed payment request, private ERC-20 proof, memo,
receiver reconciliation or payer-owned PPOI finalization.

```text
full payer wallet -> RAILGUN Wallet SDK -> encrypted Waku request
                  -> RAILGUN Broadcaster -> Arbitrum
                  -> PPOps view-only scanner -> PAID
```

The reference implementation is not a general wallet. It is bounded evidence
tooling for one Arbitrum/native-USDC payment.

## 1. Pin the Broadcaster trust input

The Waku client accepts one or more RAILGUN addresses whose signed fee messages
authorize the expected fee range. This is a security-sensitive operator input.
PPOps never downloads or silently updates it during a payment.

Obtain the current values from a trusted, independently authenticated source.
For the controlled preflight, the operator manually reviewed Railway's public
[`railway-config-v3.3.json`](https://www.railway.xyz/config/railway-config-v3.3.json),
pinned its four `trustedFeeSigner` values and its
`/waku/2/rs/5/1` pubsub topic, and recorded the resulting local fingerprint.
That observation is point-in-time evidence, not an endorsement or permanent
trust root.

Create the ignored, owner-only configuration by repeating the signer option:

```bash
node dist/cli.js broadcaster-config-init \
  --output ./broadcaster.config.json \
  --trusted-fee-signer PINNED_FEE_SIGNER_0ZK \
  --trusted-fee-signer PINNED_FEE_SIGNER_0ZK
```

The command refuses to overwrite an existing file and prints only signer count
and a SHA-256 trust fingerprint. Review any signer rotation out of band, create
a new file deliberately, and preserve the old fingerprint with the evidence.

## 2. Run a non-financial preflight

```bash
node dist/cli.js broadcaster-preflight \
  --config ./payer.config.json \
  --broadcaster-config ./broadcaster.config.json
```

This command does not read the mnemonic, wallet database or optional EVM key.
It starts Waku, requires LightPush and Filter peers, requires a live native-USDC
quote at or above the configured reliability and remaining-lifetime floors,
prints only fingerprints/aggregate health, and disconnects. It does not create
a proof or submit a payment.

Controlled results on 2026-08-30: a ready native-USDC quote with observed
reliability between `0.84` and `1`, one or two available Broadcaster wallets,
at least five LightPush peers, at least five Filter peers and roughly five to
nine minutes of quote validity. The SDK's periodic display status can briefly
remain `Searching` after those concrete readiness checks pass. This proves
point-in-time discovery only.

## 3. Prepare a fresh request without sending

Create a new PPOps intent only after the payer has enough `Spendable` native
USDC for both payment and the eventual Broadcaster fee. Use a live request with
enough lifetime for synchronization and proof generation.

```bash
node dist/cli.js prepare-broadcaster \
  --config ./payer.config.json \
  --broadcaster-config ./broadcaster.config.json \
  --request http://127.0.0.1:8787/pay/INTENT_ID/request.json \
  --expected-signer PINNED_MERCHANT_SIGNER \
  --expected-payer PINNED_PAYER_0ZK_ADDRESS \
  --max-amount-atomic 10000 \
  --max-broadcaster-fee-atomic 50000
```

For native USDC, `10000` is `0.01 USDC` and `50000` is a maximum of
`0.05 USDC`. They are independent ceilings, not recommendations or quoted
costs. Choose both values independently.

Preparation requires a strict majority of configured RPCs to return Arbitrum
gas data within a 15-second per-provider deadline. It selects the upper median
of the healthy gas-price readings: with two configured providers both must
respond and the higher value wins; with three or more healthy readings one
extreme high outlier cannot set the price. The explicit token-fee ceiling
remains the final financial bound. The payer obtains an authorized quote,
calculates the exact token fee, checks
`payment + fee` against spendable balance, generates the proof and validates the
populated RAILGUN proxy call. It then reloads and re-verifies the live merchant
request and quote. It returns `paymentSubmitted: false`, does not create a
journal entry and does not load the EVM self-signing key.

## 4. Submit only after a separate value-bearing approval

The value-bearing command deliberately repeats all preparation against fresh
wallet/request/quote state:

```bash
node dist/cli.js pay-broadcaster \
  --config ./payer.config.json \
  --broadcaster-config ./broadcaster.config.json \
  --request http://127.0.0.1:8787/pay/INTENT_ID/request.json \
  --expected-signer PINNED_MERCHANT_SIGNER \
  --expected-payer PINNED_PAYER_0ZK_ADDRESS \
  --max-amount-atomic 10000 \
  --max-broadcaster-fee-atomic 50000 \
  --confirm-intent INTENT_ID
```

Immediately before Waku submission, the payer durably reserves the intent,
full quote fingerprint, bounded fee, payer identity and transaction nullifiers
in its owner-only journal. The nullifiers are not printed. A hash returned by
Waku is stored separately as `reportedTransactionHash`; it is not trusted as
the submitted transaction. The journal remains `SUBMITTING` until the full
payer wallet synchronizes and derives the canonical public transaction hash
from the reserved nullifiers. Only that canonical hash can move the journal to
`SUBMITTED`. A strict configured-provider majority must then agree on hash,
block hash, block number and receipt status before it moves to `MINED` or
`REVERTED`. Each provider receipt request has a 15-second deadline.

The upstream Waku client can retransmit the same encrypted transaction while it
waits and can identify a mined transaction from those same nullifiers. PPOps
does not treat a timeout as permission to create a second payment.

## 5. Resolve ambiguity without retrying

If submission returns an error, `PENDING`, `SUBMITTING` or `SUBMITTED`, do not
delete the journal and do not rerun `pay-broadcaster`:

```bash
node dist/cli.js recover-broadcaster \
  --config ./payer.config.json \
  --intent-id INTENT_ID \
  --expected-payer PINNED_PAYER_0ZK_ADDRESS
```

For every non-terminal record, recovery synchronizes the original full payer
wallet and rederives the public transaction from the reserved nullifiers. It
rejects a conflict with any previously derived canonical hash and never treats
the Waku-reported hash as receipt authority. Once canonical identity exists, it
requires the same strict receipt quorum. A result that remains unresolved is
explicitly `paymentRetryPermitted: false`.

After `MINED`, run the existing `finalize-poi` command for that exact intent.
PPOps may fulfill only after receiver state reaches:

```text
FINALIZED + SPENDABLE + MATCHED -> PAID
```

## Claim boundary

A passing value-bearing Gate B would show that this payment did not use the
payer's public EVM address to submit the RAILGUN proxy transaction. It would not
prove network-layer anonymity, universal wallet usability, freedom from timing
analysis, independent adoption or production availability. RPC, PPOI, artifact,
DNS/Waku and Broadcaster operators remain external metadata and availability
dependencies.
