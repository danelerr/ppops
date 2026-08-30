# PPOps impact thesis and evidence-gated roadmap

Date: 2026-08-23

Status: product and public-good direction, not a v0.1 feature commitment.

## Decision

PPOps v0.1 remains a RAILGUN-only, self-hosted, view-only payment reconciler.
The controlled pilot does not justify adding a wallet, liquidity network,
second privacy rail or new cryptography before the mainnet and adoption gates
pass.

The larger ambition is instead:

> Make the operational privacy and usability of Ethereum private payments
> independently measurable, reproducible and improvable.

Cryptographic privacy is necessary, but a user still loses if the wallet is
unavailable, the RPC leaks or fails, a one-hour standby is discovered after
checkout starts, a viewing credential is mishandled, invoice metadata appears
in logs, or a merchant treats an observed but unspendable note as paid.

PPOps can turn those failure modes into executable profiles and evidence rather
than marketing claims.

## Public-good value

### For merchants

- Reconcile private payments without placing spending authority on the merchant
  server.
- Keep invoice/customer metadata local and out of the payment memo.
- Fail closed on finality, PPOI and provider disagreement.
- Produce restart, restore, webhook and metadata-leak evidence.

### For wallet and privacy-rail maintainers

- Receive reproducible reports of time-to-first-payment, provider failure,
  balance-bucket transitions, fee visibility and memo compatibility.
- Test whether a wallet supports a complete merchant payment profile rather
  than only a successful private transaction.
- Compare improvements across releases without disclosing payer identities.

### For the Ethereum ecosystem

- Establish operational privacy as a property that includes wallet/RPC
  metadata, secret handling, settlement semantics and recovery.
- Publish open schemas and test artifacts that other payment tools can verify
  independently.
- Make real adoption blockers visible before they are pushed onto end users.

## Epoch 13 alignment and current gap

The official Epoch 13 application describes **Ethereum privacy**, including
private transfers and wallet/RPC privacy, as an eligible impact area. It
requires privacy to be core, privacy-critical code to be open source and
independently buildable, and the project to be working with verifiable users.
It explicitly excludes pre-launch projects and projects without verifiable
traction.

The strongest classification for PPOps is:

```text
Primary impact area: Ethereum
Project category: Infrastructure/Developer Tooling
```

PPOps already has an Apache-2.0 repository, independently runnable code,
executable privacy tests and a live mainnet pilot in progress. It does **not**
yet satisfy the traction requirement. A self-operated payment proves software
function, not external adoption. No application narrative can replace that
missing evidence.

## Impact positioning

A concise product analogy is:

> PPOps brings a BTCPay Server-style deployment model and a payment-intent
> lifecycle to private USDC reconciliation on RAILGUN, without becoming a
> custodian or third-party payment processor.

The analogy describes the product category, not feature parity with BTCPay
Server or Stripe. PPOps v0.1 is limited to one RAILGUN network and token and has
no merchant SDK, wallet UI, QR checkout or commerce plugin.

A defensible short description is:

> PPOps is open infrastructure for evidence-based private payment operations.
> It lets a merchant reconcile RAILGUN payments from a view-only receiver and
> publishes reproducible tests for settlement eligibility, metadata leakage,
> restart safety and provider dependencies.

The impact claim is not “we invented private payments” or “we make every
private payment instant.” The claim is:

> Privacy infrastructure should be evaluated from payer preparation through
> merchant fulfillment, and those properties should be independently
> verifiable.

This is more ambitious in ecosystem leverage without pretending that v0.1 has
already solved rail-level UX.

## Evidence-gated roadmap

### Gate 0 — complete v0.1 evidence

No new product scope before all of the following exist:

- one real Arbitrum native-USDC private payment with the exact PPOps memo;
- `FINALIZED + SPENDABLE + MATCHED -> PAID` evidence;
- exactly-once webhook behavior across replay and restart;
- isolated backup/restore evidence;
- a signed, metadata-minimal mainnet gate report;
- at least one independently controlled merchant or payer completing the flow.

Status on 2026-08-30: the controlled mainnet payment, finality/PPOI/matching,
exact-once webhook, isolated restore and signed report requirements pass.
Independent operator evidence is the remaining Gate 0 item; the self-pilot must
not be counted as adoption. The minimal privacy-preserving handoff is documented
in [the independent operator pilot](EXTERNAL-PILOT.md).

The non-financial Waku/Broadcaster preflight and a complete no-send proof
preparation also pass. Its value-bearing payment is a separate privacy subgate:
until that payment reaches PPOps `PAID`, the project must not claim that a real
payer avoided the public self-signer. The preparation observed a `0.070373
USDC` Broadcaster fee for a `0.01 USDC` test payment, illustrating why explicit
fee visibility and ceilings are impact-relevant usability controls rather than
implementation detail.

Failure to complete the private-transfer primitive remains a stop condition.

### Gate 1 — payer readiness and provider resilience

Current groundwork:

- the reference payer reports PPOI-aware spendable balance, enforces exact
  amount and Broadcaster-fee ceilings, and checks payment-plus-fee affordability;
- direct Waku preflight reports aggregate peer/quote health without loading the
  wallet, while payer gas reads use bounded upper-median majority selection and
  receipt reads require a strict identical-response majority;
- Railway Wallet is no longer on the critical path.

Candidate v0.2 work beyond that groundwork:

- a local-only payer readiness check for chain, native token, spendable balance,
  estimated Broadcaster fee and memo support;
- explicit separation between **onboarding** and **checkout-ready** states;
- expiry recommendations based on payer readiness rather than a fixed example;
- richer RPC/provider independence and dependency reporting for the payer;
- structured onboarding measurements without exporting addresses, balances or
  wallet identifiers to the merchant;
- wallet compatibility tests that can be reproduced by maintainers;
- wallet-adapter compatibility beyond the existing SDK reference payer;
- scan-progress correctness tests and metadata-only stall diagnostics for payer
  wallets; the controlled pilot found a reproducible stale-50% display bug in
  Railway Wallet `v5.24.21` and published a minimal upstream-applicable patch.

This work can reduce surprises and provider failures. It cannot bypass a
rail-enforced standby period.

### Gate 2 — operational privacy profile

Extract a small, versioned profile from the proven implementation:

```text
descriptor authenticity
opaque reference handling
view-only/no-spend boundary
public metadata leakage
unique settlement identity
finality policy
PPOI/spendability semantics
restart and restore behavior
RPC/PPOI dependencies
time to first eligible payment
fee and manual-step visibility
```

Produce a machine-readable report and a minimal conformance runner. Validate it
first against PPOps/RAILGUN, then seek one independent wallet or payment project
to reproduce or endorse the profile before describing it as an ecosystem
standard.

### Research gate — reduce time to first private payment

Investigate, with separate kill tests, without committing v0.1 to any option:

1. **Pre-positioned user-owned private liquidity.** Best trust model, but still
   requires users to prepare before checkout.
2. **Sponsored or liquidity-assisted private settlement.** Could make the payer
   experience faster, but introduces liquidity, availability, pricing,
   compliance and possible custody/trust assumptions.
3. **A second privacy rail.** Evaluate only if it provides stable settlement
   identity, receiver-side viewing/reconciliation, metadata-safe references and
   a no-spend merchant boundary. Being faster is insufficient by itself.
4. **Wallet/RPC privacy infrastructure.** Local RPC proxies, provider rotation
   or self-hosted paths may improve resilience, but provider correlation and
   operational cost must be measured rather than hidden.

Each research path needs a threat model and a binary kill test before it becomes
a roadmap commitment.

## Proposed public metrics

The two strongest outcome KPIs for an Epoch 13 application are:

1. **Independent live deployments:** number of distinct merchant operators that
   publish a valid signed mainnet-gate report from the released PPOps version.
2. **Verified private settlements:** number and success rate of mainnet payment
   intents that reach the strict `FINALIZED + SPENDABLE + MATCHED` condition,
   reported without transaction, address, reference or invoice correlation.

Supporting diagnostic metrics:

- median and p95 time from checkout-ready intent to confirmed reconciliation;
- separately reported time from first public funding to `Spendable` balance;
- RPC/PPOI failure and fallback counts;
- wallet versions that pass the memo and no-spend compatibility profile;
- independently reproduced privacy reports.

Metrics must not create a public payment graph. Aggregate counts should use a
minimum cohort size or delayed publication when a single event would be
identifying.

## Funding-to-impact path

Epoch funding would be credible if tied to concrete public artifacts:

- harden and publish the operational privacy profile and conformance runner;
- reimburse independent operators for controlled mainnet reproductions without
  purchasing favorable endorsements;
- build local payer-readiness/provider-resilience tooling;
- maintain dependency review, reproducible builds and public threat models;
- document failed experiments as well as successful integrations.

Funding should not be framed as merchant payment volume, token incentives or a
hosted custodial service. PPOps should remain useful without lock-in: open
schemas, local data ownership, exportable evidence and self-hosted operation.

## Application go/no-go

Apply to Epoch 13 only if, before submission:

- the complete mainnet gate has passed;
- the repository and release artifacts are publicly reproducible;
- at least one external operator or payer provides verifiable evidence;
- the application reports the one-hour onboarding constraint and RPC incident
  honestly;
- requested funding maps to the public deliverables and KPIs above.

If external traction is still absent, the honest outcome is not to relabel the
self-pilot as adoption. Continue the work and target a later funding round.

## Sources

- [Octant Epoch 13 application and eligibility criteria](https://octant.fillout.com/epoch-13)
- [Octant Epoch 13 privacy-round announcement](https://octant.substack.com/p/epoch-13-the-privacy-round)
- [RAILGUN Private Proofs of Innocence](https://docs.railgun.org/wiki/assurance/private-proofs-of-innocence)
- [RAILGUN balance and sync callbacks](https://docs.railgun.org/developer-guide/wallet/private-balances/balance-and-sync-callbacks)
- [RAILGUN Broadcasters](https://docs.railgun.org/developer-guide/wallet/broadcasters)
- [Controlled pilot findings](PILOT-FINDINGS.md)
