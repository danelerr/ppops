# Controlled pilot findings: privacy is an end-to-end property

First recorded: 2026-08-23. Updated: 2026-08-30.

Status: living pilot record. The controlled mainnet payment gate passed on
2026-08-30; Gate B connectivity and no-send proof preparation passed, while
its bounded value-bearing trial failed closed and external adoption remains
open. This document
distinguishes observations from upstream guarantees and future proposals. It
must not be cited as evidence of an independent merchant deployment.

## Why this record exists

PPOps began with a narrow technical question: can a self-hosted process use
only a RAILGUN viewing capability to match an encrypted payment reference to a
local merchant intent? The controlled pilot exposed a broader product truth:
private payment cryptography is only one part of a usable private-payment
system.

The payer must also acquire the right asset on the right network, configure a
working provider, move funds from a public balance into a private balance,
wait for the privacy rail's assurance policy, use a compatible wallet, preserve
the memo exactly and pay a Broadcaster. A failure at any of those steps can make
a cryptographically private payment inaccessible or operationally unsafe.

## Evidence classification

### Observed in the controlled Arbitrum pilot

- PPOps initialized from a RAILGUN view-only credential and explicitly rejected
  spending material.
- Configuration validation and preflight passed for Arbitrum One (`42161`),
  native USDC, two independent RPC origins, the `finalized` tag and one healthy
  PPOI endpoint.
- After observing intermittent unanimity failures in the two-provider profile,
  the merchant and reference payer were moved to three distinct public RPC
  origins. The resulting 2-of-3 merchant quorum passed chain/finality preflight,
  and a payer synchronization plus complete no-broadcast preparation finished
  in 6.3 seconds.
- PPOps created an idempotent local intent and returned a signed descriptor,
  receiver `0zk` address and opaque `ppops:v1` memo.
- A distinct payer wallet required public Arbitrum ETH for shielding gas and
  native Arbitrum USDC for the payment.
- Railway Wallet's default provider path was unreliable during payer setup. The
  operator added an Alchemy RPC manually before the wallet became usable. This
  is one operator observation, not a comparative availability benchmark.
- A real native-USDC shield was mined on Arbitrum One. Railway then displayed
  an estimated `01:00:25` Private Proof of Innocence standby period before the
  balance could become spendable.
- A one-hour payment-intent lifetime was unsuitable for a first-time payer: the
  intent could expire while the newly shielded balance was still pending.
- The direct SDK payer recovered enough native USDC in `Spendable` for the
  bounded `10000`-atomic request, verified a live signed PPOps request,
  generated a real transfer proof and populated a bounded `0.01 USDC`
  self-signed transaction without signing or broadcasting it. After the
  lifecycle correction in F-08, the complete
  prepare-only run finished in 7.8 seconds; a final repeat after cleanup failures
  were made fatal finished in 10.7 seconds. Both reported
  `paymentSubmitted: false`, and the final submission status remained unrecorded.
- After explicit operator approval, the harness submitted exactly one bounded
  `0.01 USDC` self-signed transfer. It mined once with a populated maximum gas
  cost of `54267840000000` wei under the approved `0.001 ETH` ceiling.
- PPOps decrypted the exact memo from view-only state, matched the native-USDC
  output and held the intent open at `CONFIRMED + PENDING + MATCHED` while the
  output was `MissingExternalPOI`.
- The payer then generated the output PPOI from the exact mined journal record.
  The payer observed `ProofSubmitted`; PPOps subsequently recovered raw `Valid`,
  `Spendable` and `FINALIZED`, and moved the intent to `PAID`.
- A controlled duplicate confirmation delivery remained one stored event;
  restart and isolated restore preserved the same projection. The signed,
  identifier-redacted report is `artifacts/mainnet-gate-report.json`.
- The direct Waku client found at least five LightPush and at least five Filter peers without
  Railway Wallet, and selected a ready native-USDC Broadcaster quote with
  observed reliability between `0.84` and `1` and roughly five to nine minutes of
  validity. This preflight opened no wallet,
  generated no proof and moved no funds.
- A subsequent Gate B preparation opened the existing full payer wallet,
  generated a private-transfer proof and populated the RAILGUN call without
  submitting it. Three providers agreed on a `1226761` gas estimate; the live
  quote produced a `70373`-atomic (`0.070373 USDC`) fee for the `10000`-atomic
  (`0.01 USDC`) request. The command reported `paymentSubmitted: false`, wrote
  no journal record and left the merchant intent `OPEN` with zero received.
- A separately authorized value-bearing Gate B trial sent one initial encrypted
  Waku request and three bounded variants that preserved the exact same input
  nullifiers. Fee quotes ranged from `0.058867` to `0.071154 USDC`, below the
  `0.08 USDC` ceiling. The first three attempts reached one Broadcaster
  identity. The final hardened retry observed 18 valid quotes across 14 unique
  identities, excluded the prior identity and selected another. Neither
  attempted identity returned a transaction hash. Final full-wallet recovery
  more than 15 minutes after the last attempt found no canonical transaction
  for the reserved nullifiers; the private balance remained `0.1895 USDC`, the
  merchant intent remained open at zero and no fee was observed as charged.

No wallet address, transaction hash, viewing credential, opaque payment
reference or invoice identifier belongs in the public version of this record.

### Confirmed by upstream documentation

- RAILGUN calls the post-shield delay the **Unshield-Only Standby Period**. The
  initial wallet policy is one hour so list providers can update their data and
  funds cannot hop addresses faster than those updates.
- During that period, funds may be returned to the original public wallet but
  cannot be used for a normal private transfer.
- A valid Private Proof of Innocence is inherited across later private
  transfers. The one-hour delay applies to newly shielded funds, not to every
  downstream receiver.
- Shield and unshield actions charge a protocol fee. Broadcasters charge a
  separate variable fee for submitting private transactions.
- RAILGUN balances have distinct buckets such as `ShieldPending`,
  `ProofSubmitted`, `Spendable` and missing-POI states. Detection alone is not
  settlement eligibility.

### Not demonstrated yet

- No independent merchant or payer has completed the full flow. The project
  therefore does not yet have verifiable external traction.
- Gate B submitted encrypted requests through two selected Waku Broadcaster
  identities but did not obtain or recover a mined transaction. It therefore
  does not demonstrate removal of the payer public gas signer from a completed
  payment.
- One successful controlled payment does not establish an availability SLO,
  general wallet usability or production readiness.

## Findings and product implications

### F-01: time to first private payment is a first-class metric

For a new RAILGUN payer, `shield mined` does not mean `ready to pay`. In this
pilot the wallet itself estimated roughly one hour until the funds could be
spent. A checkout that begins before payer readiness creates urgency, expired
intents and support burden.

PPOps can:

- require payer readiness before creating a short-lived intent;
- distinguish onboarding from checkout;
- expose explicit `PENDING` and `SPENDABLE` semantics;
- measure time from public funding to first eligible private payment.

PPOps cannot remove a protocol-enforced RAILGUN standby period while remaining
a view-only reconciler.

### F-02: wallet and RPC reliability are part of payment privacy

The controlled payer needed a manually configured commercial RPC after the
wallet's existing provider path proved unreliable. A payment system that works
only after undocumented provider surgery is not ready for general consumers.
Using a centralized RPC also creates availability and metadata-observation
dependencies even when transaction contents remain cryptographically private.

PPOps already uses a fail-closed RPC quorum for merchant-side receipt and
finality checks. That does not repair a separate payer wallet. A future local
payer component could health-check providers, support explicit fallback and
report provider dependencies without sending payer wallet data to the merchant.

### F-03: a private payment currently requires public preparation

A first-time payer needs a public EVM address, the correct chain, the correct
native token variant, gas for shielding, a shield transaction and a private
balance large enough for both the payment and Broadcaster fee. This is a much
larger onboarding surface than “send 0.01 USDC privately.”

The privacy claim must therefore cover the complete journey. PPOps should not
describe the public funding and shield steps as private. It should state exactly
which artifacts are public and where privacy begins.

### F-04: view-only is non-custodial, not low-sensitivity

A viewing credential cannot spend, but it can reveal balances, transaction
history, memos and the receiver's payment graph. Wallet interfaces place this
credential near seed/export controls, and users can easily move it through an
unsafe support channel unless the workflow is explicit.

PPOps must continue to accept the viewing credential only through a private
file or secret mount. It must never request it in a checkout, web form, support
ticket or application evidence bundle.

### F-05: privacy can fail outside the chain

Screenshots, chat messages, logs and support transcripts can correlate public
and shielded addresses or disclose opaque references even when the public
transaction does not. The executable metadata-leak test is necessary but not
sufficient; operational guidance and evidence redaction are part of the
privacy boundary.

### F-06: the initial market is existing private-liquidity users

RAILGUN users who already hold `Spendable` private assets can proceed directly
to checkout. New users face the full funding, shield and standby sequence. The
v0.1 product is therefore more credible for privacy-aware individuals, DAOs,
treasuries and repeat payers than for an impulse consumer checkout.

This is a positioning constraint, not a reason to weaken the settlement model.

### F-07: Railway v5.24.21 can display a stale 50% scan progress

The macOS pilot used Railway Wallet `v5.24.21`, source commit
`a99f8ece640afe10ee2b49db07dd0700b9742a39`. Inspection of that exact public
source found an arithmetic error in the desktop Merkle-tree progress handler:

```ts
(progressDiff - currentProgress) < Constants.MIN_PROGRESS_UPDATE
```

The intended comparison is:

```ts
progressDiff < Constants.MIN_PROGRESS_UPDATE
```

As `currentProgress` approaches `0.5`, the existing expression increasingly
suppresses valid update events. The UI can therefore remain at approximately
`50%` even while the underlying IndexedDB continues receiving writes. The
separate `Complete` event still sets progress to `1.0`, so a stale display is
not by itself proof that the SDK scan has deadlocked.

PPOps now includes two reproducible artifacts:

- `patches/railway-wallet-v5.24.21-scan-progress.patch`, which applies to the
  tagged Railway source and fixes the comparison;
- `npm run pilot:railway-sync-doctor`, which reads filesystem metadata only and
  distinguishes a running process, a recent write, measured advancement during
  an observation window and a quiet cache. It does not open the database or
  inspect wallet contents.

This UI defect is distinct from the SDK cache-corruption failure described in
RAILGUN Wallet SDK issue `#133`. A cache that changes during an observation
window proves measurable progress even if the percentage is stale. A recent
write alone is weaker evidence because the app may subsequently close or stop.
A running UI that claims to be syncing while its cache has received no writes
beyond the configured threshold and remains unchanged throughout an explicit
observation window is a suspected stall and requires separate recovery. During
the pilot, Railway resumed after a compute interval slightly longer than ten
minutes and grew the cache by roughly 43 MB, so ten minutes alone is not a safe
stall threshold.

### F-08: SDK completion and polling need one explicit owner

The first direct-SDK preparation exposed two lifecycle mistakes in the initial
PPOps integration:

1. PPOps awaited both `refreshBalances` and `awaitWalletScan`. In the pinned SDK,
   the historical refresh path decrypts with `deferCompletionEvent=true`, so
   the event awaited by `awaitWalletScan` is not a reliable completion signal
   for that operation. A secondary poller scan happened to emit it in some
   runs, producing delays from seconds to several minutes.
2. The SDK listener poller and PPOps' explicit scanner both owned
   synchronization. The poller can schedule delayed TXID work after new UTXO
   events. One prepare-only run completed correctly, but a delayed task then
   accessed LevelDB after SDK shutdown and the process exited with an error.

PPOps now has a single scan owner. Both runtimes pause the SDK listener poller,
await the explicit `refreshBalances` promise, and then read TXOs/current PPOI
buckets directly. The merchant daemon drains its owned scan before closing
LevelDB. The finite payer unloads provider, engine and LevelDB before explicitly
terminating the prover's remaining worker threads. Structured progress separates
history completion, spendable balance, gas estimation, proof and preparation.

Controlled results after the correction:

- payer prepare-only: 7.8 seconds, sufficient spendable native USDC, proof
  generated, transaction populated, no journal record and no broadcast; a final
  cleanup-enforced repeat completed in 10.7 seconds with the same no-broadcast
  result;
- merchant first scan: approximately 6 seconds to readiness;
- after the final observability correction, five following scheduled merchant
  scans completed normally at roughly 34-second cadence.
- the value-bearing payer proof, broadcast and receipt completed in about ten
  seconds; merchant detection followed on the scheduled scanner without the
  earlier multi-minute lifecycle stall.

This does not prove future RPC/PPOI latency or an availability SLO. It does show
that the earlier multi-minute behavior was not an unavoidable Groth16 cost:
most of it came from incorrect completion/poller ownership around the SDK.

### F-09: an RPC `block` error was mislabeled as a storage `lock`

The safe error classifier originally searched for the substring `lock`. Every
RPC quorum message mentioning a `block` therefore appeared as
`STORAGE_LOCKED`, even though the process continued using the same open LevelDB
and the next scan succeeded. This created a false storage-corruption narrative
around transient two-provider quorum failures.

The classifier now uses a word-bounded storage-lock match and a separate
`RPC_QUORUM` code. Scan completion also normalizes to progress ratio `1` when
the SDK emits `Complete` without a numeric progress value. These changes do not
hide outages: each quorum read gets one bounded retry, then persistent
disagreement still fails closed, degrades readiness, and is retried by the next
single-owner scan.

Progress snapshots are also scoped to one explicit scan. Before that reset,
the first UTXO update of a new pass could carry `txid: Complete` from the prior
pass into `/v1/health`. A live regression now shows only current UTXO state at
that point and both trees at `Complete` only after the current scan finishes.

### F-10: two providers provide verification, not failure tolerance

With two RPC origins, PPOps correctly requires both responses: one timeout or
temporary disagreement prevents a false confirmation, but also makes that scan
fail. The controlled daemon observed isolated `RPC_QUORUM` failures followed by
successful scans at the next interval. This was fail-closed behavior, not a
LevelDB or RAILGUN synchronization failure.

The controlled profiles now use three distinct public origins. PPOps' majority
quorum can tolerate one unavailable or outlying origin while still requiring
two agreeing responses; it never falls back to a single provider. The updated
merchant preflight reported three providers and a healthy finalized-block
quorum. The reference payer then synchronized and prepared the same `0.01 USDC`
request in 6.3 seconds, generated its proof and populated the bounded
transaction, while `paymentSubmitted` remained false and the submission journal
remained empty.

This improves fault tolerance but adds another external metadata and
availability dependency. Three public endpoints do not prove organizational
independence, and production operators should use providers under separately
verified administrative control.

### F-11: a mined private transfer still needs payer-owned PPOI completion

The first value-bearing run exposed a lifecycle boundary that preparation could
not reveal. The transfer proof and EVM receipt succeeded, and the view-only
receiver decrypted and matched the output, but it remained
`MissingExternalPOI`. The finite payer had closed immediately after the receipt,
before its full wallet generated the proof that propagates valid provenance to
the new recipient and change outputs.

The payer now exposes `finalize-poi`. It accepts only an existing `MINED`
submission-journal record, resolves the corresponding RAILGUN transaction from
decrypted sent commitments, optionally cross-checks an independently observed
RAILGUN TXID, generates the output PPOI and requires node acknowledgement. It
cannot create a second EVM payment. In the controlled run, payer outputs reached
`ProofSubmitted` and the merchant subsequently recovered raw `Valid` and
`Spendable`.

This is an important product distinction: chain inclusion, encrypted-note
detection, PPOI propagation and merchant fulfillment are separate milestones.
A future wallet integration must own all four; PPOps should continue to fail
closed while any assurance step is missing.

### F-12: Broadcaster connectivity is feasible, but trust and recovery are product surfaces

The direct Waku preflight passed concrete peer and quote readiness checks and
discovered a usable native-USDC quote in about twelve seconds, so Railway Wallet
is not required for Broadcaster discovery either. A later no-send run also
completed wallet sync, fee calculation, proof generation and population. The
result does not make the path trustless. Fee authorization depends on a signer
list, discovery depends on DNS/Waku peers, submission depends on a selected
Broadcaster, and receipt resolution still depends on RPC providers.

The reference payer therefore pins the reviewed fee-signer list locally instead
of downloading mutable configuration during payment. It fingerprints that
trust input, imposes quote reliability/lifetime and atomic-USDC fee limits,
requires enough private balance for payment plus fee, and persists nullifiers
before Waku submission. An ambiguous response first enters recovery and never
permits a fresh payment. A deliberate retry may only regenerate a conflicting
variant for the same signed request, payer and exact nullifier set, must select
a previously unattempted Broadcaster identity, and is capped at three local
retry reservations. Cross-intent reuse of any unresolved nullifier is rejected.
The value-bearing path remains unproven until one payment reaches PPOps `PAID`
and its payer-owned PPOI is finalized.

The no-send run made fee visibility concrete. A `0.05 USDC` maximum failed
safely before proof, while the passing diagnostic preparation observed an exact
`0.070373 USDC` Broadcaster fee for a `0.01 USDC` payment. The fee can change
and the diagnostic ceiling was not spending authorization. Small payments can
therefore be economically poor even when the protocol path is technically
available; checkout software must display and independently cap the fee.

It also exposed quote rotation during proof generation. The pinned client keeps
the latest broadcast per Broadcaster, so an exact fee-ID fingerprint can
disappear while the proof is still valid. The payer now prefers the original
quote and accepts a live successor only when Broadcaster address, token and
fee-per-gas are identical. Any proof-bound economic change fails closed. For a
real submission, the exact quote used to build the encrypted Waku request is
the one persisted in the recovery journal.

An adversarial review exposed another necessary distinction before that value
gate: a transaction hash returned by the Broadcaster is not proof that the
reserved RAILGUN spend mined. The payer now journals it only as a reported hash,
resynchronizes the original full wallet and derives the canonical public hash
from the reserved nullifiers. Only that canonical hash can reach `SUBMITTED`,
receipt quorum or `MINED`; a conflicting reported hash is retained for diagnosis
but cannot drive state. Gas and receipt RPC calls also have local deadlines.
Gas selection uses the upper median from a healthy strict majority so one high
outlier cannot set the value when at least three healthy readings exist, while
the explicit token-fee ceiling remains the financial stop.

The value-bearing trial then exposed the remaining dependency limit. Four
same-nullifier variants across two selected identities returned no usable hash;
one response was the upstream-sanitized `UNKNOWN_ERROR` and another was an
unclassified post-send failure. The hardened final discovery saw 14 unique
valid identities, so this was not a lack-of-peer or lack-of-quote failure. It
also did not prove that all Broadcasters would fail. The safe conclusion is
narrower: this client/payload path did not complete through the two identities
actually attempted, and additional blind sends were not justified.

The journal now distinguishes definitive authenticated rejection from every
ambiguous post-send outcome, records only stable non-secret categories and
keeps the reserved notes locked after the retry cap. That behavior protects
funds, but it creates a manual-review state with no automatic liveness escape.
This is an honest operational limitation, not a passed Gate B.

## Claim discipline

After the controlled mainnet gate but before external adoption, PPOps may claim:

- open-source, self-hosted and view-only architecture;
- a working local intent, descriptor, reconciliation and evidence pipeline;
- reproducible primitive/privacy tests;
- a completed, signed and redacted Arbitrum mainnet self-pilot;
- one exact private native-USDC payment reconciled only after finality, PPOI and
  matching agreed;
- restart, restore and webhook-deduplication evidence for that self-pilot.

PPOps must not yet claim:

- production readiness or general consumer usability;
- reliable Railway or public-RPC availability;
- external adoption;
- sender unlinkability until Broadcaster-based Gate B passes;
- removal of RAILGUN's one-hour first-funding delay;
- privacy against voluntary credential, screenshot or support-channel leaks.

## Immediate actions

1. Keep Railway Wallet out of the critical path and retain the independent
   `tools/ppops-payer` package as the reproducible payer.
2. Preserve the Gate A operator records and signed public report with the beta
   release.
3. Preserve the failed Gate B journal and stop value-bearing retries. Diagnose
   the official client/Broadcaster response path with upstream maintainers or a
   non-financial reproducible fixture before authorizing another funded trial.
4. Repeat with an independently operated merchant or payer.
5. Capture onboarding time, provider failures, fees and support steps alongside
   the existing settlement evidence.

## Sources

- [RAILGUN Private Proofs of Innocence](https://docs.railgun.org/wiki/assurance/private-proofs-of-innocence)
- [RAILGUN balance and sync callbacks](https://docs.railgun.org/developer-guide/wallet/private-balances/balance-and-sync-callbacks)
- [RAILGUN costs and fees](https://docs.railgun.org/community-faqs/readme/costs-and-fees)
- [RAILGUN Broadcasters](https://docs.railgun.org/developer-guide/wallet/broadcasters)
- [Railway Wallet v5.24.21 progress handler](https://github.com/Railway-Wallet/Railway-Wallet/blob/v5.24.21/desktop/src/services/engine/engine.tsx#L221-L234)
- [RAILGUN Wallet SDK issue #133](https://github.com/Railgun-Community/wallet/issues/133)
- [PPOps controlled pilot guide](PILOT-GUIDE.md)
- [PPOps Arbitrum mainnet gate](MAINNET-GATE.md)
