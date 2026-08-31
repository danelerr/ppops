# Gate B: Waku Broadcaster payment

Status: **PASS** on Arbitrum mainnet, 2026-08-30. An isolated payer completed a
value-bearing Broadcaster payment on its first submission, independently
resolved the canonical transaction from reserved nullifiers, completed PPOI and
reached PPOps `FINALIZED + SPENDABLE + MATCHED -> PAID`. The earlier ambiguous
lineage remains reserved and is preserved below as negative evidence.

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
  --max-broadcaster-fee-atomic YOUR_ACCEPTED_MAXIMUM
```

For native USDC, `10000` is `0.01 USDC`; a value such as `50000` would cap the
fee at `0.05 USDC`. Replace `YOUR_ACCEPTED_MAXIMUM` with an integer you approve.
The amount and fee are independent ceilings, not recommendations or quoted
costs. Choose both values independently.

Preparation requires a strict majority of configured RPCs to return Arbitrum
gas data within a 15-second per-provider deadline. It selects the upper median
of the healthy gas-price readings: with two configured providers both must
respond and the higher value wins; with three or more healthy readings one
extreme high outlier cannot set the price. The explicit token-fee ceiling
remains the final financial bound. The payer obtains an authorized quote,
calculates the exact token fee, checks
`payment + fee` against spendable balance, generates the proof and validates the
populated RAILGUN proxy call. A strict configured-RPC majority must then simulate
that exact calldata with a positive gas estimate. Before simulation, prepare
mode reads the existing submission journal and rejects any populated nullifier
held by another non-rejected, non-reverted intent. It does not print either the
nullifier or conflicting intent. After simulation, the payer reloads and
re-verifies the live merchant request and quote. It returns
`paymentSubmitted: false`, does not create a journal entry and does not load the
EVM self-signing key.

Broadcaster fee messages can rotate while proof generation is in progress. The
payer prefers the exact original quote. It may use a live successor only when
the Broadcaster address, native-USDC token and fee-per-gas are identical, so the
proof-bound fee recipient and amount do not change. A different address, token
or rate fails closed and requires proof regeneration. `pay-broadcaster`
persists the exact successor quote actually used to construct the encrypted
Waku request, not an earlier discovery result.

Controlled no-send result on 2026-08-30:

- request amount: `10000` atomic (`0.01 USDC`);
- first `50000`-atomic fee ceiling: rejected safely before proof because the
  live fee exceeded the ceiling;
- diagnostic preparation ceiling: `179000` atomic;
- exact observed fee: `70373` atomic (`0.070373 USDC`);
- gas estimate: `1226761`, with three configured providers agreeing;
- quote reliability: `0.84`, with approximately 299 seconds remaining;
- proof generated: yes; payment submitted: no;
- submission journal record: none; merchant intent: `OPEN`, zero received.

The observed Broadcaster fee was larger than the test payment and can change on
the next run. It is evidence for operator-visible fee bounds, not an approved
spend or a prediction. The first live preparation also exposed fee-ID rotation
in the client cache; the proof-compatible rotation rule above was added and
covered by regression tests before the passing repeat. RAILGUN's
[private-transaction UX guidance](https://docs.railgun.org/developer-guide/wallet/transactions/ux-private-transactions)
likewise treats proof generation and fee expiry as separate lifecycle steps.

After the funded trial failed closed, a second no-send diagnostic exercised the
new exact-call simulation guard:

- pre-proof SDK estimate: `1128365`;
- final populated-calldata estimate: `1123239`;
- final simulation agreement: all three configured RPCs;
- exact observed fee: `64892` atomic (`0.064892 USDC`);
- proof generated: yes; payment submitted: no; journal record: none.

This makes invalid final calldata/proof an unlikely explanation under those RPC
views. It does not validate the Broadcaster's off-chain fee extraction, PPOI
checks, wallet/runtime/provider state or send path, and it is not a Gate B pass.

The next live prepare-only run exercised the journal admission rule. The Wallet
SDK generated a proof that selected at least one nullifier already reserved by
the unresolved funded lineage. The command returned only
`SUBMISSION_ALREADY_RECORDED` and stopped before final simulation, encrypted
request construction, Waku or a new journal record. No payment or fee moved.
The currently reported private balance must therefore not fund a new intent;
the old lineage must be resolved or independently fresh inputs must first pass
this same prepare-time admission check.

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
  --max-broadcaster-fee-atomic YOUR_SEPARATELY_APPROVED_MAXIMUM \
  --confirm-intent INTENT_ID
```

Immediately before Waku submission, the payer durably reserves the intent,
exact submission-quote fingerprint, bounded fee, payer identity and transaction
nullifiers in its owner-only journal. The nullifiers are not printed. A hash
returned by Waku is stored separately as `reportedTransactionHash`; it is not
trusted as the submitted transaction. The journal remains `SUBMITTING` until the full
payer wallet synchronizes and derives the canonical public transaction hash
from the reserved nullifiers. Only that canonical hash can move the journal to
`SUBMITTED`. A strict configured-provider majority must then agree on hash,
block hash, block number and receipt status before it moves to `MINED` or
`REVERTED`. Each provider receipt request has a 15-second deadline.

The final calldata quorum occurs before the encrypted Waku request is prepared
and before this reservation. A failed or minority-only simulation therefore
has no relay ambiguity and consumes no retry slot.

The upstream Waku client can retransmit the same encrypted transaction while it
waits and can identify a mined transaction from those same nullifiers. PPOps
does not treat a timeout as permission to create a second payment.

## 5. Recover first; retry only the same nullifiers

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
explicitly `paymentRetryPermitted: false`; creating a fresh intent does not
make reuse of the reserved input notes safe.

After the upstream-recommended waiting period and another empty recovery, the
operator may deliberately invoke `retry-broadcaster` with the exact same live
request, payer, limits and intent confirmation. This is not a normal payment
retry:

```bash
node dist/cli.js retry-broadcaster \
  --config ./payer.config.json \
  --broadcaster-config ./broadcaster.config.json \
  --request http://127.0.0.1:8787/pay/INTENT_ID/request.json \
  --expected-signer PINNED_MERCHANT_SIGNER \
  --expected-payer PINNED_PAYER_0ZK_ADDRESS \
  --max-amount-atomic 10000 \
  --max-broadcaster-fee-atomic YOUR_SEPARATELY_APPROVED_MAXIMUM \
  --confirm-intent INTENT_ID
```

The payer regenerates the proof, then aborts before Waku unless its input
nullifier set is byte-for-byte identical to the original durable reservation.
All variants therefore conflict on-chain: at most one can consume the inputs.
It also rejects nullifier reuse by any different local intent, excludes every
previously attempted Broadcaster identity, and permits at most three such
retry reservations. If no different valid identity is available, discovery
fails before proof/submission and consumes no retry slot. Every recognized
post-send rejection is journaled by a stable category; every timeout, malformed
hash, unknown response or unclassified post-send failure remains ambiguous.
Raw dependency errors and Broadcaster identities are not printed.

When the retry cap is reached without a canonical hash, the record remains
`SUBMITTING`, reports `manualReviewRequired: true`, and continues reserving its
nullifiers. PPOps does not invent a timeout after which an unknown transaction
becomes cryptographically impossible.

After `MINED`, run the existing `finalize-poi` command for that exact intent.
PPOps may fulfill only after receiver state reaches:

```text
FINALIZED + SPENDABLE + MATCHED -> PAID
```

## 6. Controlled value-bearing results

### 6.1 First lineage: safe unresolved failure

The controlled `0.01 USDC` attempt used a `0.08 USDC` maximum Broadcaster fee.
The initial request and three bounded same-nullifier retries produced fee quotes
between `0.058867` and `0.071154 USDC`. The first three Waku submissions reached
one Broadcaster identity; the final hardened retry discovered 18 valid quotes
from 14 unique identities, excluded the prior identity and selected another.

Both attempted identities returned post-send failures without a transaction
hash. One response was the upstream-sanitized `UNKNOWN_ERROR`; another remained
an unclassified client/transport failure. A final recovery more than 15 minutes
after the last attempt found no canonical public transaction for the reserved
nullifiers; the private balance remained `0.1895 USDC` and the merchant intent
remained `OPEN` with zero received/pending value. The retry cap is exhausted and
PPOps will not send another variant. No Broadcaster fee was observed as charged.

This remains useful negative evidence: direct Waku discovery, fee calculation,
proof generation, exact-nullifier regeneration and alternate-identity selection
worked, but those two selected Broadcaster identities did not complete the
payment. The original nullifiers remain reserved and must never be reused for a
different intent.

A metadata-minimal, maintainer-ready account of the failure and concrete
questions is available in the [upstream interoperability
report](UPSTREAM-BROADCASTER-REPORT.md). Do not attach local wallet state, raw
journal data, nullifiers or requests when escalating it.

### 6.2 Isolated lineage: passing first submission

A later trial used independently fresh inputs in a newly generated payer
lineage. The payer waited until the protocol-fee-adjusted shield output moved
from `ShieldPending` to `Spendable`, then created a new six-hour merchant intent
for `10000` atomic native USDC (`0.01 USDC`).

The no-send preparation completed with:

- `149625` atomic available as `Spendable`;
- a `100000`-atomic operator fee ceiling;
- `1195972` pre-proof gas and `1191953` exact final-calldata gas;
- strict majority agreement from two of three configured RPC origins;
- a `67110`-atomic (`0.067110 USDC`) quote;
- proof generated, no journal record and no payment submitted.

The separately authorized value-bearing command then repeated every guard and:

- obtained a `66912`-atomic (`0.066912 USDC`) fee below the ceiling;
- simulated the exact populated calldata through RPC quorum;
- durably reserved fresh nullifiers before Waku;
- received one reported hash from the selected Broadcaster;
- independently derived the same canonical hash from those nullifiers;
- obtained a successful quorum receipt and `MINED` state on the first attempt;
- used zero retries and did not load an EVM self-signing key.

The payer requested output PPOI, observed all three relevant statuses reach
`Valid`, and recovered its `72713`-atomic change entirely as `Spendable`.
Separately, PPOps decrypted the memo through view-only state, first held exactly
`10000` atomic pending, then reached
`FINALIZED + SPENDABLE + MATCHED -> PAID`. A clean receiver stored exactly one
`payment.confirmed` event and rejected an authenticated replay as a duplicate.
Same-state restart, isolated secret-bearing backup/restore and the signed public
Mainnet Gate report all passed. Public evidence intentionally omits the payer,
intent, memo, nullifiers and transaction identifiers.

## Claim boundary

The passing value-bearing Gate B shows that this controlled payment did not use
the payer's public EVM address to submit the RAILGUN proxy transaction. It does
not prove network-layer anonymity, universal wallet usability, freedom from
timing analysis, independent adoption or production availability. RPC, PPOI,
artifact, DNS/Waku and Broadcaster operators remain external metadata and
availability dependencies.
