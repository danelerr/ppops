# PPOps Broadcaster differential review

Review date: 2026-08-30

Reviewed baseline: `716b54d` (`docs: record passing Arbitrum mainnet gate`)

Initial Broadcaster implementation: `25f3afb`

Remediated implementation: `136c4bc`

Reviewer: repository-grounded automated differential review; not an independent
third-party audit

## Executive summary

The Gate B delta adds a bounded Waku Broadcaster submission path to the separate
`ppops-payer` harness. PPOps merchant code and its view-only trust boundary do
not gain payer spending authority.

The adversarial review found one Medium and two Low implementation issues. All
three were corrected in `136c4bc` and have regression coverage. No open Critical,
High or Medium application finding was confirmed in the reviewed delta.

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

Disposition: **acceptable for a bounded beta Gate B trial after fresh financial
authorization; not production-ready**. The value-bearing Gate B payment and an
independently operated pilot remain unexecuted. This review moved no funds.

## Scope and change surface

The reviewed range `716b54d..136c4bc` contains three commits, 34 changed files
and approximately 5,112 additions / 101 deletions. Much of that volume is the
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

1. reserves payer identity, complete quote fingerprint, bounded fee and unique
   nonzero nullifiers before encrypted submission;
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

The fix validates the runtime quote object before field access, enforces safe
integer version components, and revalidates the complete quote fingerprint
(Broadcaster, token, fee ID, fee-per-gas and expiration) after proof generation.
Malformed candidates are ignored; a changed quote fails closed.

## State and trust-boundary invariants after remediation

- PPOps merchant runtime remains view-only and cannot import payer code.
- `prepare-broadcaster` performs no journal write or Waku submission.
- `pay-broadcaster` still requires exact intent, payer, amount, fee and explicit
  intent confirmation.
- The payer's optional EVM self-signing key is not loaded in Gate B.
- A durable reservation exists before the first Waku send attempt.
- `reportedTransactionHash` never authorizes receipt lookup.
- A Broadcaster `SUBMITTING` record cannot contain a canonical
  `transactionHash`.
- `SUBMITTED`, `MINED` and `REVERTED` require canonical transaction identity;
  terminal states additionally require a block number.
- An unresolved reservation always returns `paymentRetryPermitted: false`.
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

- merchant: 19 test files, 58 tests;
- reference payer: 14 test files, 56 tests;
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
- exact quote-fingerprint revalidation and malformed quote rejection;
- safe-integer version bounds;
- unique/nonzero nullifiers and cross-state journal validation;
- RPC deadline behavior, majority retention and high-outlier gas selection.

## Limitations and residual risks

- No value-bearing Gate B transaction was submitted during this review.
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

Keep `136c4bc` and the updated runbooks. Before any Gate B claim:

1. create a fresh unexpired intent;
2. run non-financial `prepare-broadcaster` and record the bounded fee;
3. obtain explicit approval for the exact USDC amount and maximum Broadcaster
   fee;
4. submit once, recover ambiguity only through the journal and nullifiers;
5. finalize payer PPOI and require PPOps
   `FINALIZED + SPENDABLE + MATCHED -> PAID`;
6. repeat the documented flow with an independently controlled operator.

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
