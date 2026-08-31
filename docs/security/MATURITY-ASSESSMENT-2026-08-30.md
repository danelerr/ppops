# PPOps beta maturity assessment

Date: 2026-08-30  
Release assessed: `v0.1.0-beta.1`  
Method: Trail of Bits nine-category code-maturity framework  
Scope: merchant daemon and the separately executed reference payer

This is a repository-grounded maintainer self-assessment, not an independent
security audit or production certification. Ratings use a 0–4 scale: Missing,
Weak, Moderate, Satisfactory and Strong.

## Executive summary

Overall maturity: **2.7 / 4.0 (upper Moderate)**.

PPOps has unusually strong trust-boundary documentation, fail-closed payment
semantics and reproducible mainnet evidence for a beta. Its principal gaps are
operational evidence from an independent deployment, external security review,
low integration coverage around SDK-heavy runtime paths and concentration of
necessary complexity in large CLI/evidence modules.

The assessment supports publishing and independently piloting the beta. It does
not support an unattended or general production deployment claim.

## Scorecard

| Category | Rating | Evidence-based conclusion |
| --- | ---: | --- |
| Arithmetic | Satisfactory (3) | Atomic values use bounded base-10 strings and `bigint`; conservation, ordering, partial and overpayment behavior have property tests. |
| Auditing/monitoring | Moderate (2) | Structured failures, readiness, authenticated metadata-free metrics, alert thresholds and incident steps exist; no independently exercised alert/SLO or incident-response drill exists. |
| Authentication/access control | Satisfactory (3) | Loopback default, constant-time bearer verification, HMAC webhooks, owner-only secret files and merchant/payer role separation are tested. One bearer role remains intentionally coarse. |
| Complexity management | Moderate (2) | Core reconciliation is small and orthogonal, but payer CLI, mainnet evidence and journal modules are large and costly to review. |
| Decentralization/operator control | Satisfactory (3) | Software is self-hosted, non-custodial and has no upgrade/admin contract; RPC, PPOI, SDK, Waku and Broadcaster dependencies remain explicit external trust/availability points. |
| Documentation | Satisfactory (3) | Product boundary, threat model, operational profile, recovery, mainnet gates and negative findings are public and aligned with the implementation. |
| Transaction ordering/replay | Satisfactory (3) | Finality/PPOI gating, exact settlement identity, durable nullifier reservation, canonical-hash recovery, bounded retries and exact-once outbox behavior cover the relevant off-chain ordering risks. |
| Low-level manipulation | Satisfactory (3) | PPOps contains no Solidity, assembly or new cryptography; sensitive cryptographic and transaction construction is delegated to pinned libraries and checked at typed boundaries. |
| Testing/verification | Moderate (2) | CI, Docker builds, SBOMs, coverage gates, property tests, privacy checks and controlled mainnet gates pass; SDK wrapper/CLI coverage remains low and there is no mutation testing or independent long-lived integration. |

## Detailed evidence and next-level gaps

### 1. Arithmetic — Satisfactory

Payment amounts are validated as positive base-10 integers and capped at
`uint256` before descriptor signing (`src/intents/service.ts:97-102`,
`src/security/descriptor.ts:37-41`). Projection uses only `bigint` sums and
comparisons (`src/reconciliation/projection.ts:18-67`). Property tests exercise
conservation, overpayment, pending value and settlement-order invariance over
generated inputs (`test/properties.test.ts:82-137`).

Next level: extend generators to the full `uint256` boundary and add a written
table of every numeric input bound. This is not a correctness blocker for the
current single-token profile.

### 2. Auditing and monitoring — Moderate

The daemon exposes liveness/readiness plus authenticated Prometheus output
(`src/api/app.ts:224-255`, `src/api/app.ts:398-436`). The production runbook
defines concrete alert thresholds and compromise responses
(`docs/PRODUCTION-RUNBOOK.md:49-66`, `docs/PRODUCTION-RUNBOOK.md:109-121`). Logs
use classified, redacted failures rather than raw provider/secret data.

Gap: no external operator has demonstrated alert delivery, backup cadence,
restore timing or an incident drill. Record those during the independent pilot
before raising this rating.

### 3. Authentication and access controls — Satisfactory

The operational API binds to loopback by default and requires an explicit
remote opt-in (`src/config.ts:45-59`, `src/config.ts:128-136`). Bearer comparison
uses fixed-length SHA-256 digests with `timingSafeEqual`
(`src/security/auth.ts:1-12`). Webhook signatures cover timestamp, key ID, event
ID and exact payload and enforce freshness (`src/events/webhook.ts:25-83`). The
merchant build rejects payer imports and spending material; filesystem secret
readers reject unsafe files.

Gap: a remotely exposed multi-client deployment would need scoped credentials,
per-client audit identity and external TLS/mTLS. That deployment is outside the
documented beta profile.

### 4. Complexity management — Moderate

Intent projection and event eligibility are deliberately separated into small
modules. Necessary payer recovery state is explicit rather than hidden in an
automatic retry. However, `tools/ppops-payer/src/cli.ts`,
`src/pilot/mainnet-gate.ts`, and
`tools/ppops-payer/src/security/submission-journal.ts` remain large orchestration
surfaces. Their size increases review and change-risk even with tests.

Next level: after the external pilot freezes behavior, split command parsing
from command execution and split evidence schemas from capture/verification.
Do not perform that refactor immediately before adoption testing.

### 5. Decentralization and operator control — Satisfactory

There is no upgradeable contract, admin key or custodian. The merchant controls
the daemon, SQLite mapping, provider selection and receiver spending wallet;
PPOps holds only view capability. The production runbook recommends distinct
RPC administrative domains and documents the inherited PPOI dependency
(`docs/PRODUCTION-RUNBOOK.md:20-37`).

Residual centralization is external: the pinned Wallet SDK, configured RPCs,
PPOI endpoint, Waku network and selected Broadcaster can censor, delay or
observe timing. PPOps fails closed but cannot remove those rail-level risks.

### 6. Documentation — Satisfactory

`README.md`, `docs/PRODUCT-MODEL.md`, `docs/OPERATIONAL-PROFILE.md`,
`docs/THREAT-MODEL.md`, both gate runbooks and `docs/PILOT-FINDINGS.md` describe
the trust boundaries, state model, recovery and negative results. Public gate
reports provide machine-readable evidence without direct payment identifiers.

Gap: the payer-facing experience is still a technical reference workflow, not
end-user documentation for a broadly supported wallet integration.

### 7. Transaction ordering and replay — Satisfactory

PPOps credits only `FINALIZED + SPENDABLE + MATCHED` settlements. SQLite
uniqueness and immutable identity comparison protect rediscovery; projection
and outbox insertion are transactional. The payer reserves bounded unique
nullifiers before Waku, rejects cross-intent reuse, distinguishes reported from
canonical hashes and permits only exact-nullifier bounded retries
(`tools/ppops-payer/src/security/submission-journal.ts:274-490`). Tests include
hash conflicts, ambiguity, provider disagreement and retry identity diversity.

No AMM, oracle, swap or user-selectable slippage exists in PPOps, so classic
sandwich risk is not an application concern. Timing/privacy observation by
infrastructure remains documented.

### 8. Low-level manipulation — Satisfactory

The repository has no Solidity, `delegatecall`, inline assembly or custom
cryptographic primitive. It uses Ethers typed-data verification and the pinned
RAILGUN SDK. Populated transactions are validated for target, calldata, value,
nullifiers and configured-RPC simulation before submission.

The residual risk is supply-chain/runtime code execution inside the SDK-bearing
process, already rated high in `docs/THREAT-MODEL.md` (TM-005). SBOMs, exact
locks, high/critical audit gates and the separate payer trust domain reduce but
do not eliminate it.

### 9. Testing and verification — Moderate

Merchant and payer suites run independently in CI. Verification includes
coverage floors, TypeScript builds, privacy canaries, package-boundary checks,
production dependency audit, Docker build, SBOMs and signed gate reports. The
controlled mainnet Gate A and Gate B settlements passed, including restart,
isolated restore and duplicate webhook delivery.

Coverage is materially weaker in live-SDK wrappers and large CLIs than in core
database/reconciliation/security code. There is no mutation-testing campaign,
formal verification or independently operated long-duration fixture. These are
the main reasons this category cannot be Satisfactory.

## Priority roadmap

### Critical before a production claim

1. Complete one independently controlled merchant pilot using the immutable
   beta release and retain candid failure/feedback evidence. Estimated effort:
   one operator-day plus rail onboarding latency.
2. Obtain an independent security/privacy review of the merchant daemon and
   payer submission journal, then publish remediations. Estimated effort:
   several reviewer-days.

### High after the external pilot

1. Add integration seams/mocks around scanner/runtime engine lifecycles and
   raise coverage there without faking live-gate evidence.
2. Refactor the payer CLI and evidence orchestration along stable trust
   boundaries.
3. Exercise alerting, key-compromise and isolated-restore procedures and record
   recovery objectives.
4. Track upstream remediation of legacy RAILGUN/Web3/Waku advisories; rerun all
   primitive/mainnet gates for any dependency change.

### Medium

1. Add mutation testing for projection, descriptor, webhook and submission
   journal invariants.
2. Measure repeated provider/PPOI/Broadcaster latency and failure rates without
   publishing correlatable payment metadata.
3. Add scoped API identities only if a real remote multi-client deployment
   requires them.
