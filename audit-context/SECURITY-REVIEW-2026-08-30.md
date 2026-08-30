# PPOps hardening review addendum

Review date: 2026-08-30

Version: `0.1.0-beta.0` working tree after direct-SDK prepare-only validation

Reviewer: repository-grounded automated review; not an independent third-party audit

## Outcome

The hardening delta closes seven application/lifecycle weaknesses found while
preparing the first bounded Arbitrum payment. No Critical or High application
finding was confirmed. The merchant and payer suites pass, and a live
prepare-only run completed sync, PPOI bucket recovery, gas estimation, proof
generation and transaction population without signing or broadcasting.

This is not a production-readiness or Mainnet Gate claim. The value-bearing
Gate A transfer, `FINALIZED + SPENDABLE + MATCHED -> PAID`, restart/restore
evidence for that settlement, Gate B Broadcaster path and external users remain
open.

### Post-review status

Later on 2026-08-30, Gate A passed: one bounded `0.01 USDC` Arbitrum payment
reached PPOps `FINALIZED + SPENDABLE + MATCHED -> PAID`, and restart, restore
and webhook replay evidence passed. The subsequent Waku/Broadcaster
implementation and non-financial connectivity preflight also passed; no
value-bearing Gate B payment has been made. The post-review payer suite now has
14 test files and 48 tests; its Waku-enabled dependency graph has 10 Moderate
and 30 Low findings, with zero Critical/High findings. This paragraph records
later state and does not retroactively expand the review scope below.

## Reviewed changes

### SEC-010 — Historical refresh waited on an event it may defer

Severity: **Medium**

Status: **Fixed and exercised live**

The initial scanner and payer combined `refreshBalances` with
`awaitWalletScan`. In the pinned SDK, historical refresh decrypts with
`deferCompletionEvent=true`; the latter event is therefore not a reliable
completion primitive for that path. Completion depended on an unrelated later
poller scan and varied from seconds to minutes.

Both runtimes now own one explicit `refreshBalances` call and then read the
current TXOs/PPOI buckets. `PENDING` remains fail-closed and can become
`SPENDABLE` on a later scan. Controlled payer prepares completed in 7.8 and
10.7 seconds; the latter made any cleanup failure fatal and still exited cleanly.
The merchant reached readiness in about 6 seconds and, after the final
observability correction, completed five more scheduled scans at roughly
34-second cadence.

### SEC-011 — SDK poller could outlive the owned LevelDB lifecycle

Severity: **Medium**

Status: **Fixed and exercised live**

The SDK listener poller could overlap PPOps' explicit scan and schedule delayed
TXID work. One otherwise successful prepare-only run later attempted a LevelDB
operation after shutdown. PPOps and the payer now pause that redundant poller.
The daemon drains its active explicit scan before runtime teardown. The payer
unloads provider, engine and LevelDB before terminating referenced prover
workers. Subprocess tests verify flushed success/error output and deterministic
exit.

### SEC-012 — Submission ambiguity lacked a pre-broadcast transaction identity

Severity: **Medium**

Status: **Materially mitigated**

The payer now constructs and validates an exact type-2 transaction, signs it
locally, computes its hash, and durably records hash plus nonce before raw RPC
broadcast. RPC acceptance must return the same hash. Journal states distinguish
`SUBMITTING`, `SUBMITTED`, `MINED` and `REVERTED`; receipt timeout returns
`PENDING` and never authorizes an automatic retry.

Residual risk: an operator must investigate a `SUBMITTING`/`PENDING` record on
chain and in PPOps. The tool intentionally has no journal-delete retry escape.

### SEC-013 — Long preparation could use a changed live request

Severity: **Medium**

Status: **Fixed**

Value-bearing submission now accepts only an HTTP(S) request source. After sync,
gas estimation, proof and population, it reloads the live request, verifies the
pinned merchant signer and requires every signed payment field and status to
match the original open request before signing.

### SEC-014 — Missing receipt was classified as a reversion

Severity: **Medium**

Status: **Fixed**

A newly decrypted TXO can precede public receipt visibility. Missing receipt now
maps a new settlement to `OBSERVED`, not `REVERTED`. A previously finalized
settlement that loses quorum receipt visibility still maps to `REVERTED` for
reorg handling. Regression coverage distinguishes both cases.

### SEC-015 — RPC block failures were mislabeled as storage locks

Severity: **Low**

Status: **Fixed and exercised live**

The safe error classifier matched the substring `lock`, including the word
`block` in RPC quorum errors. Transient provider disagreement therefore appeared
as `STORAGE_LOCKED` despite the same LevelDB remaining open and later scans
succeeding. Storage locking now uses a word-bounded match and RPC agreement
failures use the dedicated `RPC_QUORUM` code. A completed SDK scan is also
normalized to progress ratio `1` when the wrapper omits its numeric progress.
Quorum reads retry once without reducing the required agreement; persistent
disagreement still fails closed.

### SEC-016 — The root npm tarball included payer source

Severity: **Low**

Status: **Fixed and mechanically enforced**

The merchant build and Docker image excluded `tools/ppops-payer`, but the root
package lacked an explicit npm allowlist. A dry-run tarball therefore contained
the payer source even though the package is private and no secrets were present.
Both packages now publish only compiled `dist` content plus npm's mandatory
metadata/README/license files. The executable trust-boundary check requires the
merchant allowlist, and final dry runs found no payer runtime or secret/config
paths in the merchant tarball.

### SEC-017 — Concurrent maintenance could overlap webhook delivery

Severity: **Low**

Status: **Fixed and regression-tested**

`deliverPending` previously depended on the daemon's serial scheduler. Two
programmatic maintenance calls could both select the same pending outbox rows
before either marked them delivered, causing avoidable simultaneous retries.
The delivery service now serializes its own passes. A concurrent regression
holds the first HTTP request open, starts a second pass and proves that each
stored event is sent once while the queued pass observes an empty outbox.

### SEC-018 — Installed merchant CLI did not run through npm's binary symlink

Severity: **Medium**

Status: **Fixed, regression-tested and exercised from a clean install**

The merchant entry point guarded test imports by comparing `process.argv[1]`
directly with `import.meta.url`. npm invokes Unix package binaries through a
`node_modules/.bin` symlink, so the comparison failed and the installed `ppops`
command exited successfully without doing anything. The guard now compares
canonical real paths while retaining import safety. A regression covers an
npm-style symlink, and a newly packed tarball was installed into an empty
directory where `ppops --help` printed the complete command surface.

### SEC-019 — Scan progress mixed current and previous tree state

Severity: **Low**

Status: **Fixed, regression-tested and exercised live**

The health layer cleared progress when a scan started, but the engine retained
its previous snapshot. The first UTXO callback of the next scan therefore
reintroduced the prior scan's `txid: Complete`, presenting mixed-cycle state.
Each scanner pass now begins a fresh engine progress window before its owned
`refreshBalances`. A lifecycle regression enforces the ordering. Live health
showed `hasTxid: false` during the first UTXO phase, followed by both UTXO and
TXID `Complete` at ratio `1` after the same scan finished.

### Additional boundary hardening

- Intent creation rejects unknown fields, including accidental mnemonic or key
  material.
- `prepare-self-signed` exercises the full path without signature, journal or
  broadcast.
- The populated destination must equal the pinned RAILGUN proxy, ETH value must
  be zero, fees/gas/nonce/chain/type are locally bounded, and fee/account state
  is refreshed immediately before signing.
- Docker shutdown grace now matches the non-cancellable scan-drain policy.
- Merchant and payer npm tarballs use explicit compiled-runtime allowlists.

## Verification evidence

- Merchant: 19 test files, 58 tests, typecheck, build, privacy conformance,
  trust-boundary check and enforced coverage passed.
- Payer: 9 test files, 28 tests, typecheck, build and privacy check passed.
- Dependency gates: zero Critical/High production advisories; 6 Moderate and 30
  Low transitive advisories remain in each pinned RAILGUN graph.
- Arbitrum prepare-only: `0.01 USDC`, sufficient spendable native USDC, real
  proof, populated transaction, `paymentSubmitted: false`, no submission record;
  final cleanup-enforced repeat completed in 10.7 seconds.
- Merchant runtime: first explicit scan reached ready in approximately 6
  seconds; after the final observability correction, five following scans
  completed normally at roughly 34-second cadence.
- Clean-install smoke: independently packed merchant and payer tarballs
  installed into empty directories and both package binaries executed through
  their generated npm links; the merchant regression was repeated after its
  direct-execution fix.

## Remaining release blockers at review time

1. Explicit operator approval and one bounded value-bearing Gate A transfer.
2. Merchant reconciliation through `FINALIZED + SPENDABLE + MATCHED -> PAID`.
3. Mainnet restart, restore and webhook duplicate-delivery artifact.
4. Waku/Broadcaster Gate B for sender unlinkability.
5. At least one independent operator installation and payment.

CI verification and Docker-image build evidence for the final hardening commit
completed successfully in [GitHub Actions run 33319219724](https://github.com/danelerr/ppops/actions/runs/33319219724).

The known dependency advisories, external RPC/PPOI trust, unencrypted backup
bundles and public self-signer linkage described in the 2026-08-29 review remain
accepted beta risks; this addendum does not close them.
