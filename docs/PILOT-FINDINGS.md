# Controlled pilot findings: privacy is an end-to-end property

Date: 2026-08-23

Status: living pilot record. The mainnet payment gate is still in progress.
This document distinguishes observations from upstream guarantees and future
proposals. It must not be cited as evidence that PPOps has completed its
mainnet gate or acquired external users.

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

- A private native-USDC payment carrying the exact PPOps memo has not yet
  completed this mainnet pilot.
- The merchant intent has not yet reached `PAID` from a settlement that is
  simultaneously `FINALIZED`, `SPENDABLE` and `MATCHED`.
- Restart, restore and receiver-side duplicate-delivery evidence have not yet
  been captured for a real mainnet settlement.
- No independent merchant or payer has completed the full flow. The project
  therefore does not yet have verifiable external traction.

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
larger onboarding surface than “send 0.10 USDC privately.”

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

## Claim discipline

Until the mainnet and adoption gates pass, PPOps may claim:

- open-source, self-hosted and view-only architecture;
- a working local intent, descriptor, reconciliation and evidence pipeline;
- reproducible primitive/privacy tests;
- a successfully initialized Arbitrum mainnet profile;
- one observed mainnet shield and documented payer-onboarding findings.

PPOps must not yet claim:

- completed end-to-end mainnet payment reconciliation;
- production readiness or general consumer usability;
- reliable Railway or public-RPC availability;
- external adoption;
- removal of RAILGUN's one-hour first-funding delay;
- privacy against voluntary credential, screenshot or support-channel leaks.

## Immediate actions

1. Remove Railway Wallet from the critical path and import the payer into the
   separate, local `ppops-payer` Wallet SDK harness.
2. Run the direct SDK sync from the recorded shield block and require native
   USDC in the `Spendable` bucket.
3. Create a fresh intent only after that readiness condition holds.
4. Complete Gate A with a bounded self-signed exact-memo transfer, then complete
   the PPOps mainnet evidence gate.
5. If Gate A passes, complete Gate B through a Waku Broadcaster and retain
   Railway only as an optional compatibility client.
6. Repeat with an independently operated merchant or payer.
7. Capture onboarding time, provider failures, fees and support steps alongside
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
