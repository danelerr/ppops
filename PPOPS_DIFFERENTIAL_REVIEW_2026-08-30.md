# PPOps Broadcaster differential review

Review date: 2026-08-30

Reviewed baseline: `716b54d` (`docs: record passing Arbitrum mainnet gate`)

Initial Broadcaster implementation: `25f3afb`

Remediated implementation: `136c4bc`

Operational follow-up: `e09245e`

Ambiguity/retry remediation: `5d07fa0`

Final-calldata simulation remediation: `b6d5e3d`

Prepare-time nullifier admission remediation: `d70057e`

Reviewer: repository-grounded automated differential review; not an independent
third-party audit

## Executive summary

The Gate B delta adds a bounded Waku Broadcaster submission path to the separate
`ppops-payer` harness. PPOps merchant code and its view-only trust boundary do
not gain payer spending authority.

The initial adversarial review found one Medium and two Low implementation
issues. The funded trial and follow-up review found one additional Medium
cross-intent nullifier risk and two Low ambiguity/retry risks. A post-trial
review found two further Low pre-submission evidence gaps. All eight are fixed
in `136c4bc`, `5d07fa0`, `b6d5e3d` and `d70057e` with regression coverage. No
open Critical, High or Medium application finding is confirmed in the reviewed
delta.

The most important correction separates three different facts:

```text
Waku-reported hash
        !=
nullifier-derived canonical transaction hash
        !=
quorum-confirmed receipt
```

A Broadcaster response can no longer drive `SUBMITTED`, receipt lookup or
`MINED`. The payer first rederives the canonical public hash from the exact
nullifiers durably reserved before Waku submission. Merchant fulfillment remains
independently fail-closed behind `FINALIZED + SPENDABLE + MATCHED`.

Disposition: **the implementation fails closed, but another funded Gate B trial
is not justified until the client/Broadcaster response failure is reproduced or
diagnosed; not production-ready**. The funded trial was attempted without a
reported/recovered transaction, and an independently operated pilot remains
unexecuted. The review methods themselves moved no funds.

## Scope and change surface

The reviewed range `716b54d..d70057e` contains 19 commits, 53 changed files and
approximately 10,135 additions / 296 deletions. Much of that volume is the
pinned Waku dependency lockfile and new tests. The security-sensitive production
surface is concentrated in:

- Broadcaster trust configuration and quote validation;
- Waku lifecycle, discovery and encrypted submission;
- proof population and fee/amount bounds;
- write-ahead submission state;
- nullifier-based transaction recovery;
- RPC gas and receipt reads;
- CLI confirmation and recovery behavior.

All changed production TypeScript files in `tools/ppops-payer/src/` were reviewed.
No production source file was deleted. The self-signed path's duplicated
populated-transaction checks were replaced by a shared validator that also
rejects empty/invalid calldata and nonzero ETH value; this is a strengthening,
not a removed control.

## Findings

| ID | Severity | Status | Finding |
| --- | --- | --- | --- |
| DR-001 | Medium | Fixed | Broadcaster-reported hash could be treated as canonical transaction identity |
| DR-002 | Low | Fixed | Slow RPCs and one extreme gas-price response could deny bounded progress |
| DR-003 | Low | Fixed | External quote/runtime version values lacked complete structural and safe-integer validation |
| DR-004 | Medium | Fixed | A different intent could reserve nullifiers already held by an unresolved Broadcaster submission |
| DR-005 | Low | Fixed | Broadcaster rejection and chain-ambiguous post-send failures were not separated into durable safe categories |
| DR-006 | Low | Fixed | A bounded ambiguity retry could repeatedly select the same failing Broadcaster identity |
| DR-007 | Low | Fixed | The exact post-proof populated calldata was not independently simulated before Waku |
| DR-008 | Low | Fixed | Prepare mode did not reject inputs already reserved by another unresolved intent |

### DR-001 — Broadcaster-reported hash was not bound to reserved nullifiers

The initial flow accepted the hash returned by the Waku client, marked it
`SUBMITTED`, and queried receipts for that hash. A malicious or defective
Broadcaster could return an unrelated valid transaction hash. If that unrelated
transaction had a quorum-visible successful receipt, the payer journal could
incorrectly reach `MINED` and the operator evidence could identify the wrong
transaction.

PPOps merchant fulfillment would still require the receiver's matched,
finalized, PPOI-spendable note, so this did not create a direct false-fulfillment
path in the merchant daemon. It did create payer evidence-integrity risk and
could permanently block the intended intent as an ambiguous/double-payment
denial of service.

The fix:

1. reserves payer identity, the exact encrypted-submission quote fingerprint,
   bounded fee and unique nonzero nullifiers before submission;
2. stores the Waku result only as `reportedTransactionHash` while status remains
   `SUBMITTING`;
3. synchronizes the original full payer wallet and calls the RAILGUN nullifier
   lookup;
4. allows only that derived canonical hash to reach `SUBMITTED` and receipt
   quorum;
5. repeats canonical derivation during every non-terminal recovery and rejects
   conflict with a previously stored canonical hash;
6. retains a mismatching reported hash only as metadata for diagnosis.

Primary controls are in
`tools/ppops-payer/src/railgun/broadcaster-transfer.ts`,
`tools/ppops-payer/src/security/submission-journal.ts` and
`tools/ppops-payer/src/cli.ts`. Regression tests cover an unresolved canonical
hash, a malicious mismatching reported hash, impossible journal states and the
wrong expected payer.

### DR-002 — RPC calls and gas outliers could deny progress

Payer-specific gas and receipt reads had no local request deadline. Gas
selection also chose the maximum healthy value, so one extreme high response
could force an excessive calculated Broadcaster fee or make preparation fail.
The explicit operator fee ceiling prevented unbounded spend, limiting the
practical impact primarily to availability.

The fix adds a 15-second per-provider deadline, requires a strict healthy
majority and selects the upper median gas price. With two configured providers,
both must answer and the higher value wins. With at least three healthy readings,
one extreme high outlier cannot set the price. A strict majority of identical
transaction hash, block hash, block number and status observations remains
required for receipt state. Tests include a permanently hanging provider and a
high outlier.

Residual risk: two correlated providers can still lie or fail together, and the
RAILGUN SDK has its own provider behavior. PPOps does not verify cryptographic
RPC proofs.

### DR-003 — External quote and version inputs were incompletely bounded

The TypeScript type for a discovered Broadcaster quote did not protect the
runtime boundary from malformed Waku objects. Version syntax permitted numeric
components larger than JavaScript's safe integer range. Both conditions could
cause inconsistent comparisons or an unbounded operational failure.

The fix validates the runtime quote object before field access and enforces safe
integer version components. It prefers the complete original quote fingerprint
after proof generation. A live successor quote is accepted only when its
Broadcaster address, token and fee-per-gas are identical, preserving the
proof-bound recipient and amount while allowing the fee ID and expiration to
rotate. A change to any proof-bound economic field fails closed. Malformed
candidates are ignored.

The first live no-send proof preparation exposed why that distinction matters:
the pinned client cache replaced an otherwise compatible fee ID while proof
generation was in progress. Follow-up `e09245e` added the compatibility rule
and also makes `prepareSubmission` return the exact quote used to construct the
encrypted Waku request. That exact fingerprint and fee ID—not a prior discovery
snapshot—are now durably journaled before submission. Regression coverage
rejects changed fee rates and verifies compatible rotation and exact
submission-quote persistence.

### DR-004 — unresolved nullifiers were scoped only to one intent

The original journal prevented a second submission for the same intent but did
not compare input nullifiers across different intent records. After an
ambiguous Waku result, the full wallet could still regard those notes as
spendable and generate a different merchant payment from the same inputs. Two
variants could not both succeed on-chain, but which merchant intent won would
be nondeterministic and an operator could mistake the loser for a safe retry.

`5d07fa0` normalizes and compares every reserved nullifier before any initial
Broadcaster Waku send. It rejects overlap with every non-rejected,
non-reverted Broadcaster record. A same-intent retry is the sole exception and
must reproduce the exact complete nullifier set already stored.

### DR-005 — response ambiguity needed durable semantics

The Waku client can return explicit pre-submission rejections, errors that may
still correspond to an on-chain send, malformed hashes, transport timeouts or
unknown dependency errors. Treating all of them as one generic failure left
the journal safely blocked but did not preserve enough non-secret state for a
reviewable recovery decision.

The fix maps the official stable server responses into rejection or ambiguity
categories. Only authenticated definitive rejections may become `REJECTED`;
timeouts, invalid hashes, unknown responses and every unclassified failure
after `send()` starts remain `SUBMITTING`. Raw errors are never logged or
persisted. The CLI exposes category/count/limit state without nullifiers,
Broadcaster addresses or secret material.

### DR-006 — retry selection needed identity diversity

A same-nullifier variant is safe from double settlement, but repeatedly sending
it to the same broken Broadcaster provides no useful liveness and consumes the
local retry budget. The hardened retry excludes every identity recorded by the
initial request and prior retry reservations. Discovery reports only aggregate
candidate counts and fails before proof/submission if no different valid
identity exists. Selection among eligible quotes is deterministic by fee,
reliability and fingerprint. The retry count is capped at three.

### DR-007 — final populated calldata needed a pre-Waku simulation

The payer obtained the Wallet SDK's unproven-transfer gas estimate before proof
generation and later validated the populated target, calldata shape and zero
ETH value. It did not independently ask the configured RPC set to execute
`eth_estimateGas` against the exact post-proof calldata. An SDK regression or
proof/population mismatch could therefore have reached the durable reservation
and Waku boundary before being detected, turning a locally diagnosable failure
into an ambiguous relay outcome.

Merchant settlement would still fail closed and the amount/fee ceilings would
remain intact, so the practical impact was availability and evidence ambiguity,
not direct false fulfillment. The fix simulates the exact validated target and
calldata from the same non-funded dummy sender used by the upstream estimation
path. A strict majority of distinct configured RPC origins must return a
positive estimate within bounded deadlines; the upper median is selected. This
happens before encrypted-request construction, journal reservation or Waku.

The post-trial no-send diagnostic passed on all three configured RPCs: the
pre-proof estimate was `1128365`, the final estimate was `1123239`, and the
point-in-time Broadcaster fee was `64892` atomic (`0.064892 USDC`). No payment
or journal record was created. This makes invalid final calldata unlikely under
those RPC views and narrows, but does not solve, the remote Broadcaster failure.

### DR-008 — prepare mode needed the same nullifier admission check

The atomic `reserveBroadcaster` mutation rejected input nullifiers held by any
other non-rejected, non-reverted Broadcaster record. Prepare-only mode stopped
before that mutation, so it could report a complete proof and simulation even
though the later value-bearing command was guaranteed to fail before Waku. No
second spend could be sent, but the no-send result overstated operational
readiness and encouraged unnecessary proof generation and fee approval.

The fix adds a read-only journal admission check immediately after population.
It applies the same active-record policy without printing the nullifiers or
conflicting intent, permits the current intent for exact-set retry validation,
and retains the mutation-time recheck to close the race. A conflict aborts
before final RPC simulation, encrypted-request construction, journal mutation
or Waku.

The live follow-up selected at least one input held by the unresolved funded
lineage and failed safely with `SUBMISSION_ALREADY_RECORDED`. It created no new
journal record and submitted no payment. The existing private balance therefore
cannot be assumed available for a fresh Gate B intent merely because the Wallet
SDK still reports it as spendable.

## State and trust-boundary invariants after remediation

- PPOps merchant runtime remains view-only and cannot import payer code.
- `prepare-broadcaster` performs no journal write or Waku submission.
- Prepare mode reads the local journal and rejects any populated input reserved
  by another active intent before calling the final simulation quorum.
- A strict configured-RPC majority simulates the exact populated proof/calldata
  before Waku construction or journal mutation.
- `pay-broadcaster` still requires exact intent, payer, amount, fee and explicit
  intent confirmation.
- The payer's optional EVM self-signing key is not loaded in Gate B.
- A durable reservation exists before the first Waku send attempt.
- The reservation fingerprints the exact quote used for the encrypted Waku
  request; proof-compatible rotation cannot change Broadcaster, token or rate.
- `reportedTransactionHash` never authorizes receipt lookup.
- A Broadcaster `SUBMITTING` record cannot contain a canonical
  `transactionHash`.
- `SUBMITTED`, `MINED` and `REVERTED` require canonical transaction identity;
  terminal states additionally require a block number.
- An unresolved reservation always returns `paymentRetryPermitted: false`.
- Different intents cannot reserve an unresolved nullifier.
- A deliberate ambiguity retry preserves the signed request, payer and exact
  nullifier set, excludes attempted identities and is locally capped.
- Only a definitive classified pre-submission rejection or a quorum-confirmed
  reverted transaction can release the notes for a fresh intent; every unknown
  post-send result remains manual review.
- PPOps independently requires receiver finality, PPOI spendability and memo
  matching before intent credit.

## Blast radius and history review

The payer is a separate package and runtime under `tools/ppops-payer`; the root
build, npm package and Docker boundary exclude it. The changed critical symbols
have a small direct call surface (approximately two to five production callers
each), but their value-bearing impact is high because they construct, submit and
recover a private USDC spend.

History was reviewed from the Gate A evidence commit through the Broadcaster
feature, documentation and remediation commits. Existing write-ahead and
self-signed safety patterns originated in the earlier Gate A hardening and were
preserved. No suspicious deletion of validation, error handling or retry
protection was found.

## Verification performed

`npm run verify:all` passed after remediation:

- public CI run
  [`33337865296`](https://github.com/danelerr/ppops/actions/runs/33337865296)
  passed its `verify` and `docker` jobs at `207837c`, including Broadcaster and
  shield-key remediations;
- merchant: 19 test files, 58 tests;
- reference payer: 15 test files, 82 tests;
- TypeScript typechecks and production builds;
- merchant coverage thresholds;
- merchant and payer privacy checks;
- merchant/payer build and package trust-boundary check;
- production dependency audit gate with zero Critical/High advisories.

The dependency audit still reports 6 Moderate / 30 Low findings for the merchant
RAILGUN graph and 10 Moderate / 30 Low for the Waku-enabled payer graph. The
available forced remediations downgrade pinned RAILGUN/Waku packages and are not
safe mechanical fixes.

The new payer regressions specifically exercise:

- reported hash pending while canonical lookup is unresolved;
- a conflicting Waku-reported hash losing to the nullifier-derived hash;
- receipt lookup using only the canonical hash;
- wrong expected payer rejection before terminal journal state is trusted;
- exact-quote preference, proof-compatible quote rotation, changed-rate
  rejection and malformed quote rejection;
- persistence of the exact quote used for encrypted submission;
- safe-integer version bounds;
- unique/nonzero nullifiers and cross-state journal validation;
- RPC deadline behavior, majority retention and high-outlier gas selection.
- exact populated-calldata simulation majority and pre-reservation failure.
- prepare-time cross-intent nullifier conflict and terminal-record release.

## Limitations and residual risks

- The later value-bearing Gate B trial sent encrypted Waku requests but did not
  obtain a reported or canonical transaction hash. Four same-nullifier variants
  across two selected identities all remained unresolved; synchronized payer
  balance stayed `0.1895 USDC` and no fee was observed as charged.
- A live no-send preparation generated the proof and observed a `70373`-atomic
  Broadcaster fee for a `10000`-atomic request, but wrote no journal and left
  the merchant intent open with zero received.
- A later no-send run successfully quorum-simulated the exact populated
  calldata and observed a `64892`-atomic fee, but this cannot reproduce the
  Broadcaster's private off-chain fee/PPOI/runtime validation or sanitized
  response path.
- After adding the read-only admission check, the current diagnostic proof
  selected at least one nullifier owned by the unresolved lineage and stopped
  before simulation/Waku. Another funded trial needs independently fresh inputs
  or a cryptographically resolved prior lineage, not a higher fee ceiling.
- The RAILGUN Wallet SDK, engine, Waku client, proving artifacts, PPOI services,
  Broadcasters and protocol cryptography were treated as dependencies, not
  independently audited.
- A compromised payer host or dependency can access full spending authority.
- Nullifier-to-transaction recovery is an upstream SDK/protocol primitive; the
  project verifies its returned format and consistency but not a separate
  cryptographic proof of that mapping.
- RPC/PPOI/Waku/Broadcaster operators can observe timing and availability
  metadata. Gate B does not prove IP-layer anonymity.
- This review intentionally did not open ignored secrets, wallet databases,
  local configuration or private evidence.
- The completed Gate A self-pilot is not external adoption. An independent
  installation and payment remain required for traction claims.

## Recommendation

Keep `136c4bc`, follow-up `e09245e`, ambiguity remediation `5d07fa0`, final-call
simulation remediation `b6d5e3d`, prepare admission remediation `d70057e` and
the updated runbooks. Before any Gate B claim:

1. retain the unresolved journal and do not delete, reset or bypass its
   nullifier reservation;
2. diagnose the client/Broadcaster failure with a non-financial reproducible
   fixture or upstream maintainer support before another funded trial;
3. if a future fresh trial is justified, obtain explicit amount/fee approval,
   submit once and recover ambiguity through the journal first;
4. require payer PPOI and PPOps
   `FINALIZED + SPENDABLE + MATCHED -> PAID` before any Gate B claim;
5. repeat a passing released flow with an independently controlled operator.

Do not describe the project as production-ready, sender-anonymous or externally
adopted until the corresponding gates pass.

## Methodology

The review followed a repository-grounded differential process:

- established architecture and trust assumptions from `audit-context/DOSSIER.md`
  and its critical function records;
- inspected the full Git delta and relevant history;
- mapped changed entry points, state transitions and direct call sites;
- traced value, identity and recovery data across Waku, journal, full wallet,
  RPC quorum and merchant reconciliation boundaries;
- performed an adversarial pass for malicious external responses, ambiguity,
  retry behavior, timeouts, malformed inputs and state corruption;
- added tests for each confirmed issue and ran the complete repository gate.
