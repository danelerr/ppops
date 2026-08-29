# PPOps internal security review

Review date: 2026-08-29

Version: `0.1.0-beta.0` working tree after payer-repository unification

Reviewer: repository-grounded automated review; not an independent third-party audit

## Outcome

No confirmed Critical or High severity application finding remains after the
changes in this review. Six repository findings were fixed or materially
mitigated. Three known risks remain accepted for the beta and must be resolved
or explicitly accepted again before a production-readiness claim.

This result does **not** make PPOps production-ready. A fresh Arbitrum USDC
mainnet payment, the complete Mainnet Gate artifact, Gate B Broadcaster path and
external pilot evidence are still missing.

| Status | Critical | High | Medium | Low |
| --- | ---: | ---: | ---: | ---: |
| Fixed or materially mitigated | 0 | 0 | 4 | 2 |
| Open / accepted beta risk | 0 | 0 | 2 | 1 |

## Scope and method

The review covered the merchant runtime, the payer harness, their signed
request boundary, configuration and secret handling, reconciliation, webhooks,
backup/restore, Docker and CI. It combined:

- entry-point, trust-boundary, asset and invariant mapping in
  [`audit-context/DOSSIER.md`](./DOSSIER.md);
- manual data-flow and failure-path review of security-sensitive TypeScript;
- unit, integration, property, privacy and boundary tests;
- production dependency advisory review and transitive dependency tracing;
- Docker/build-context, ignore-rule and tracked-file checks.

Ignored runtime state, local configs and secret contents were not opened. The
untracked `justito-hackathon-deck.html` was excluded from the review and left
untouched.

## Fixed findings

### SEC-001 — Sensitive local inputs lacked one uniform private-file boundary

Severity: **Medium**

Status: **Fixed**

Configuration and wallet-state reads did not previously have the same strict
regular-file and permission policy as every secret read. Path validation alone
also left symlink substitution and check/open races insufficiently constrained.

The merchant and payer now use dedicated private-file readers that reject
symlinks and non-regular files, enforce maximum sizes, current-user ownership
and no POSIX group/other access, open with `O_NOFOLLOW` where available and
compare device/inode metadata before parsing. See
`src/security/private-file.ts:9-57` and
`tools/ppops-payer/src/security/private-file.ts:9-57`. Config, wallet state and
secret readers use this boundary. Regression coverage is in
`test/private-files.test.ts` and payer config tests.

### SEC-002 — Payer wallet operations were not process-exclusive

Severity: **Medium**

Status: **Fixed**

Concurrent sync/proof/payment processes could access the same full-wallet
LevelDB and wallet-state files, creating corruption or conflicting submission
risk. The payer now acquires an owner-only exclusive PID/token lock before
engine construction and holds it through shutdown
(`tools/ppops-payer/src/security/runtime-lock.ts:30-78`,
`tools/ppops-payer/src/cli.ts:339-362`). Tests cover contention, stale-lock
recovery and token-safe release.

### SEC-003 — A lost submission response could lead to an accidental second payment

Severity: **Medium**

Status: **Materially mitigated**

If an RPC accepted a signed transaction but the response was lost, a manual
retry of the same intent could pay twice. The payer now writes and fsyncs an
owner-only `SUBMITTING` reservation before broadcast, records `SUBMITTED` and
the transaction hash after a response, and refuses any locally recorded intent
(`tools/ppops-payer/src/security/submission-journal.ts:47-147`,
`tools/ppops-payer/src/railgun/self-signed-transfer.ts:241-255`). A read-only
`submission-status` command exposes the state without secret material.

Residual risk: `SUBMITTING` is deliberately ambiguous after response loss. The
operator must inspect the public signer nonce, chain and PPOps state and create
a new intent only after reconciliation. Deleting the journal to retry is unsafe.

### SEC-004 — Raw runtime failures could disclose paths or provider details

Severity: **Low**

Status: **Fixed**

CLI and persisted webhook errors could include upstream messages, local paths or
endpoint details. Merchant CLI failures and payer failures now return stable
enumerated codes; webhook retry/dead-letter state stores a classified code
instead of the raw exception (`src/security/failures.ts:1-65`,
`src/events/webhook.ts:6-33`, `src/events/webhook.ts:128-145`). Redaction tests
exercise secret/path/provider canaries.

### SEC-005 — Endpoint URLs allowed HTTP userinfo credentials

Severity: **Low**

Status: **Fixed**

HTTP userinfo embedded in RPC, PPOI or webhook URLs could be copied into configs
and operational tooling. Both config schemas now reject non-empty URL username
or password fields (`src/config.ts:23-31`,
`tools/ppops-payer/src/config.ts:15-27`). Provider API keys in a URL path or
query remain possible and must still be treated as sensitive configuration;
prefer an unlogged deployment-secret mechanism where the provider supports it.

### SEC-006 — Proof generation could outlive request expiry

Severity: **Medium**

Status: **Fixed**

A request verified as open could expire during a long wallet sync or proof.
The payer now rechecks expiry immediately before journal reservation and
submission (`tools/ppops-payer/src/railgun/self-signed-transfer.ts:241-244`).
Mining can still occur after expiry; merchant policy must treat a valid late
settlement according to PPOps `PAID_LATE` semantics.

## Open and accepted beta risks

### SEC-007 — Legacy RAILGUN dependency tree retains advisories

Severity: **Medium**

Status: **Open; upstream-dependent**

`npm audit --omit=dev` reports 6 moderate and 30 low production advisories in
both packages, with no high or critical advisory. The principal path is the
pinned RAILGUN engine through `circomlibjs`, legacy `web3`/`web3-bzz`,
`swarm-js`, `servify` and `request`. The affected surface includes SSRF,
prototype-pollution and legacy elliptic/UUID findings, but exploit reachability
from PPOps was not established by this review.

Current controls are exact lockfiles, compatible overrides, high/critical CI
failure, two CycloneDX SBOMs and a narrow runtime profile. Do not run
`npm audit fix --force`: its proposed dependency changes are breaking and do
not constitute a reviewed RAILGUN upgrade. Track upstream removal/fixes and
repeat the primitive/mainnet gates for any dependency change.

### SEC-008 — Backup confidentiality and authenticity are external

Severity: **Medium**

Status: **Accepted for beta**

PPOps inventories backup files with SHA-256 but does not encrypt or
cryptographically authenticate the bundle. An attacker able to replace the
manifest can replace files and recompute checksums; `--include-secrets` bundles
also expose the viewing and service identity material to their storage layer.

Use external authenticated encryption, immutable/versioned storage and an
independently checked merchant signer/viewing-wallet fingerprint. Do not treat
the checksum manifest as proof of provenance.

### SEC-009 — Gate A submits through the first healthy RPC

Severity: **Low**

Status: **Accepted for diagnostic Gate A**

The payer validates the chain and bounded fee data but selects one healthy RPC
for balance reads and submission
(`tools/ppops-payer/src/railgun/self-signed-transfer.ts:49-75`). That provider
can censor, delay or make the post-broadcast result ambiguous. This is primarily
an availability and operational-evidence risk; the populated transaction target,
chain, value and maximum gas cost are locally bounded. Gate B should use the
RAILGUN Broadcaster path and record submission evidence independently.

## Readiness gaps (not confirmed vulnerabilities)

- Overall merchant V8 coverage passes its enforced thresholds, but live-SDK
  wrappers remain intentionally thinly unit-tested: `runtime.ts`, the RAILGUN
  engine and scanner require the primitive and Mainnet Gates for meaningful
  evidence. Unit coverage must not substitute for a fresh value-bearing flow.
- The payer tests validate request bounds, secrets, locking and journaling but do
  not generate and mine the user's real Arbitrum transfer. Gate A remains a
  manual, value-bearing operation.
- Docker was not available on the review host. The Dockerfile and YAML/build
  context were inspected and CI contains a clean `docker build`, but the image
  result must be taken from the post-push CI run rather than claimed locally.
- Gate B Broadcaster submission and verified external-user operation are absent.
  Gate A alone is publicly linkable and is not enough for the final privacy or
  Octant-impact claim.

## Architecture conclusion

Keeping `ppops` and `tools/ppops-payer` in one Git repository is appropriate:
the signed request contract, dependency updates and integration tests can now be
versioned atomically. They must remain separate packages, processes, storage
roots and deployment targets because the merchant process is view-only while
the payer intentionally holds spending authority. The executable boundary check
in `scripts/trust-boundary-check.ts` fails if merchant source imports payer code,
the payer escapes its package, spending options enter the merchant CLI, or the
merchant build/Docker image includes the payer.

The root Vitest configuration is also explicitly scoped to `test/**/*.test.ts`.
Before this review it discovered the payer's seven suites from the nested
package, ran them twice under `verify:all` and mixed payer source into merchant
coverage. The final verification reports each package independently.

## Verification evidence

The final code-bearing working tree passed:

- merchant: 17 test files, 52 tests, typecheck, build, privacy checks and
  configured coverage thresholds;
- payer: 7 test files, 19 tests, typecheck, build and recursive source privacy
  check;
- repository: trust-boundary check and high/critical production-audit gates;
- advisories: 0 critical, 0 high, 6 moderate and 30 low in each pinned RAILGUN
  production graph.

The Mainnet Gate and external adoption evidence were not run or inferred from
unit tests. Those remain release gates, not findings closed by this review.
