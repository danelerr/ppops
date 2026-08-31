# Octant Epoch 13 application draft

Status: **NO-GO FOR SUBMISSION** until the blocking evidence below exists.

This is an evidence-backed answer bank, not a copy of the dynamic Fillout form
and not a submitted application. Map it into the live form only after reviewing
the form manually. Do not replace placeholders with invented users, metrics or
partnerships.

## Short project identity

**Project:** PPOps — Private Payment Operations

**Primary impact area:** Ethereum

**Category:** Infrastructure / developer tooling

**Repository:** <https://github.com/danelerr/ppops>

**Tagline (90-character form limit):**

> PPOps reconciles private RAILGUN USDC payments without merchant spending keys.

**One-line description:**

> PPOps is an open-source, self-hosted, view-only reconciler that lets merchant
> software accept private RAILGUN USDC payment intents without publishing
> invoice metadata or giving the reconciliation server spending authority.

**Current stage:** Working beta with a controlled Arbitrum mainnet self-pilot;
not production-ready and not yet externally adopted.

## Problem

Private-transfer cryptography does not by itself give a merchant a usable or
verifiable payment operation. The controlled pilot exposed failures across the
whole journey: RPC instability, ambiguous wallet synchronization, a roughly
one-hour first-funding standby period, variable Broadcaster fees, separate PPOI
eligibility after mining and the risk that invoice/customer metadata leaks
through logs or evidence even when the chain memo is encrypted.

Merchants need a way to associate a private settlement with a local order,
wait for chain finality and spendability, survive restarts and deliver an
idempotent fulfillment event without handing a processor their funds or public
commercial graph.

## Solution

PPOps runs as a merchant-controlled daemon:

```text
merchant backend -> signed payment intent
payer -> RAILGUN private native-USDC transfer + encrypted opaque reference
PPOps view-only scanner -> finality + PPOI + matching
transactional outbox -> HMAC payment.confirmed webhook
```

The daemon accepts only a RAILGUN shareable viewing capability. It stores the
invoice mapping locally, never puts the invoice/customer identifier in the
payment memo and cannot spend receiver funds. A separate reference payer proves
that a wallet can verify the merchant request and execute the transfer without
crossing the merchant trust boundary.

## Why privacy is core

Privacy is not an optional mode or marketing layer:

- RAILGUN encrypts the payment note and opaque memo reference;
- invoice/customer metadata remains in merchant-local SQLite;
- the merchant runtime rejects mnemonics and spending keys;
- settlement is credited only after `FINALIZED + SPENDABLE + MATCHED`;
- executable privacy checks scan public artifacts, logs and package boundaries;
- public evidence intentionally removes addresses, transaction hashes,
  references and invoice identifiers.

The project does not claim IP-layer anonymity. RPC, PPOI, artifact, Waku and
Broadcaster operators remain metadata and availability dependencies.

## Public-good contribution

PPOps packages operational privacy as reproducible evidence rather than asking
users to trust a privacy claim. The current public artifacts cover:

- encrypted-memo/view-only primitive behavior;
- settlement eligibility and exact-once reconciliation;
- restart and isolated restore;
- metadata-leak checks;
- provider/PPOI dependencies;
- a signed, metadata-minimal mainnet self-pilot report;
- documented failure findings, including poor first-payment UX and fee
  visibility.

The longer-term public good is a small operational privacy profile that wallets
and payment projects can reproduce without disclosing their payment graph.

## Differentiation and novelty boundary

PPOps does **not** claim to invent private payments, RAILGUN, encrypted memos or
private Request Network payments. Its contribution is the combination of:

- self-hosted merchant operation;
- receiver view-only/no-spend isolation;
- opaque signed payment intent;
- local commercial reconciliation;
- finality/PPOI-aware fulfillment;
- restart-safe exact-once events;
- executable, redacted operational/privacy evidence.

Request Network, additional rails, Solidity and new cryptography are outside
v0.1.

## Current evidence

| Requirement | Evidence | Status |
| --- | --- | --- |
| Open-source and independently buildable | Apache-2.0 repository, pinned lockfiles, CI, Dockerfile, SBOM workflow | PASS; public verify and Docker jobs passed in [run `33344569836`](https://github.com/danelerr/ppops/actions/runs/33344569836) at release commit `99d7721` |
| View-only merchant boundary | Runtime rejection, package-boundary check and privacy tests | PASS |
| Working mainnet settlement | Gate A and isolated Gate B `0.01 USDC` Arbitrum payments reached `FINALIZED + SPENDABLE + MATCHED -> PAID` | PASS, controlled self-pilots |
| Restart/restore/webhook behavior | Signed Mainnet Gate report | PASS, controlled self-pilot |
| Broadcaster path without payer EVM self-signer | Waku preflight, proof, RPC-quorum final-call simulation, canonical nullifier recovery and bounded value-bearing trial | PASS, controlled isolated self-pilot; first submission mined, PPOI/finality/reconciliation completed |
| Verifiable users/traction | Independent operator report and feedback | **MISSING — APPLICATION BLOCKER** |
| Public release tied to evidence | Version-matching tag, CI, GHCR digest, SBOMs and gate reports | PASS — [`v0.1.0-beta.0`](https://github.com/danelerr/ppops/releases/tag/v0.1.0-beta.0), release workflow [`33344672634`](https://github.com/danelerr/ppops/actions/runs/33344672634) |

Evidence links:

- [Mainnet Gate report](../artifacts/mainnet-gate-report.json)
- [Privacy report](../artifacts/privacy-report.json)
- [Primitive Gate report](../artifacts/primitive-gate-report.json)
- [Operational profile](OPERATIONAL-PROFILE.md)
- [Pilot findings](PILOT-FINDINGS.md)
- [Threat model](THREAT-MODEL.md)
- [Broadcaster differential review](security/DIFFERENTIAL-REVIEW-2026-08-30.md)

## Users and traction

Do not submit the current self-pilot as user traction.

Replace this section only after completing
[the independent operator pilot](EXTERNAL-PILOT.md):

```text
Independent operators: <count>
Independent deployments: <count>
Verified private settlements: <count>
Release commit/tag: <value>
Public operator evidence: <link or privacy-preserving verification method>
Feedback summary: <verbatim-approved summary>
```

## Impact metrics

Primary outcome metrics:

1. number of independently controlled deployments publishing a valid signed
   report from a released PPOps version;
2. number and success rate of verified private settlements that reach
   `FINALIZED + SPENDABLE + MATCHED`, aggregated without exposing direct payment
   identifiers.

Supporting diagnostics:

- checkout-ready intent to confirmed reconciliation latency;
- public funding to first `Spendable` private balance latency, reported
  separately;
- Broadcaster fee and payment-to-fee ratio;
- RPC/PPOI failure and recovery counts;
- wallet versions that pass memo/no-spend compatibility;
- independent reproductions of the privacy report.

## Proposed use of funding

Insert the requested amount only after the applicant chooses it and verifies
the live form's rules. The defensible work packages are:

- independent security and privacy review plus remediation;
- grants/reimbursements for independently operated reproductions, without
  purchasing favorable endorsements;
- payer-readiness and provider-resilience tooling;
- operational privacy profile and conformance artifacts;
- reproducible release, SBOM and dependency maintenance;
- documentation of failed as well as successful experiments.

Do not promise a second rail, hosted custody, token incentives or a universal
standard in the v0.1 funding scope.

## Applicant-supplied form inputs

Current Octant application guidance also requires inputs that cannot be inferred
from this repository. Before submission, the applicant must provide and verify:

- the Ethereum sign-in wallet and payout/treasury address;
- project category and stage in the live form's available choices;
- the requested amount in USD and a matching use-of-funds explanation;
- team, contact and any required legal/compliance information;
- final repository, release, website and demo links.

The live Epoch 13 form remains authoritative. Its dynamic questions must be
reviewed manually before copying this answer bank.

## Honest limitations

- The merchant viewing capability exposes the complete receiver history if the
  PPOps host is compromised.
- The first shielded balance may require roughly one hour before normal private
  spending; PPOps cannot remove a rail-level standby policy.
- The controlled Gate B preparation observed a `0.070373 USDC` Broadcaster fee
  for a `0.01 USDC` payment. This was point-in-time and shows that small payments
  may be economically poor.
- An earlier funded Gate B lineage used two selected Broadcaster identities and
  exact-same-nullifier variants but returned no reported or recoverable
  transaction hash. It remains reserved and cannot fund another intent.
- A later no-send proof passed exact final-calldata simulation on all three
  configured RPCs (`1123239` gas estimate). This narrows the failure to remote
  Broadcaster processing or its sanitized response boundary, but does not turn
  preparation into a successful payment.
- A subsequent fresh-intent preparation selected an input reserved by the
  unresolved trial and failed before Waku. The passing trial therefore used a
  separately funded, isolated payer lineage after its shield became spendable.
- The isolated Gate B submission paid `0.01 USDC` with a `0.066912 USDC`
  Broadcaster fee, resolved the reported hash independently from nullifiers,
  mined on its first attempt and reached PPOps `PAID` without loading a payer
  EVM self-signing key. This is self-pilot transaction-path evidence, not proof
  of IP anonymity or external adoption.
- Public RPC/PPOI/Waku services remain availability and metadata dependencies.
- The pinned RAILGUN/Waku dependency graphs retain Moderate/Low advisories but
  no known High/Critical advisory under the current audit gate.
- One maintainer-controlled payment is engineering evidence, not traction or an
  availability SLO.

## Submission checklist

- [x] Push the reviewed implementation and obtain green public verify + Docker
      CI at release commit `99d7721`.
- [x] Publish `v0.1.0-beta.0` and verify the GHCR digest, two SBOMs and three
      gate-report attachments.
- [x] Preserve the failed Gate B lineage and record the later isolated passing
      value-bearing Gate B without expanding its privacy claim.
- [ ] Complete at least one independent operator pilot.
- [ ] Obtain permission for any operator quote or public identity reference.
- [ ] Insert real team/contact/legal/funding fields from the applicant.
- [ ] Reopen the live Fillout form and map these answers to its actual current
      questions.
- [x] Re-run report signature, link, privacy, verify and Docker checks from the
      public release.

Until the external-user checkbox is complete, the honest recommendation is
**do not submit**.

## Official references

- [Epoch 13 application](https://octant.fillout.com/epoch-13)
- [Epoch 13 Privacy Round announcement](https://octant.substack.com/p/epoch-13-the-privacy-round)
- [Current Octant application requirements](https://docs.octant.app/docs/projects/apply-for-funding/)
