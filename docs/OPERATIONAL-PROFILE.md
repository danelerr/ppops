# PPOps v0.1-R operational profile

Date: 2026-08-30

Status: beta implementation profile. This document describes behavior exercised
by the repository; it is not a production-readiness or privacy-absoluteness
claim.

## Product boundary

PPOps is a single-merchant, self-hosted reconciler for one configured RAILGUN
network and one configured ERC-20 token. It creates local payment intents,
signs payer-facing descriptors, scans an incoming view-only wallet, derives
settlement eligibility and emits local/HMAC-authenticated events.

PPOps does not create or submit spends. It has no RAILGUN mnemonic/spending-key
configuration, Solidity, Request Network adapter, UI, hosted relay, HPKE, second
privacy rail or generic adapter framework.

## Descriptor profile

Name: `PPOpsPaymentDescriptorV1`

EIP-712 domain:

```text
name:    PPOps Payment Descriptor
version: 1
chainId: configured chain
```

Signed fields:

```text
version        uint8
chainId        uint256
rail           string       # railgun
tokenAddress   address
decimals       uint8
amountAtomic   uint256
recipient0zk   string
reference      bytes32
expiresAt      uint64
nonce          bytes32
merchantSigner address
```

The reference and nonce are independently generated random 32-byte values. The
commercial reference is not signed into the descriptor and remains in local
SQLite. A verifier must compare both the recovered signer and embedded
`merchantSigner` to an address obtained independently of the descriptor.

## Settlement normalization

Only positive ERC-20 TXOs with a memo matching this exact expression enter
PPOps reconciliation:

```text
^ppops:v1:(0x[0-9a-f]{64})$
```

The scanner immediately reduces the decrypted memo to the opaque reference; it
does not persist the memo text. It records:

```text
uniqueSettlementId
chainId
txidVersion
transactionHash
tree
position
optional railgunTxid
tokenAddress
amountAtomic
blockNumber
blockTimestamp
balanceBucket
rawPPOIStatuses
chainStatus
poiStatus
reference
```

Stable identity:

```text
chainId:txidVersion:normalizedPublicTransactionHash:tree:position
```

The public transaction hash and output coordinates were stable across the gate
restart. `transactCreationRailgunTxid` is optional because the controlled and
sampled V2 TXOs returned it as null in relevant cases.

## Orthogonal settlement state

`chainStatus`:

```text
OBSERVED | CONFIRMED | FINALIZED | REVERTED
```

Finality is one policy per instance:

- `finalized`: transaction block is at or below the RPC's finalized tag.
- `confirmations`: `latest - transactionBlock + 1` reaches the configured count.

The Arbitrum mainnet profile requires `finalized`; confirmation-count finality
is rejected even at a high count. Receipt, block and finalized-height reads use
a majority quorum across all configured RPCs. Two configured providers must
both agree; three tolerate one failure or inconsistent response. Height
selection is conservative and excessive divergence fails closed. Non-final and
recently finalized persisted settlements are rechecked by transaction receipt
so a TXO that disappears from the wallet scan can be marked `REVERTED`.

`poiStatus`:

| RAILGUN balance bucket | PPOps status |
| --- | --- |
| `Spendable` | `SPENDABLE` |
| `ShieldBlocked` | `BLOCKED` |
| `ShieldPending`, `ProofSubmitted`, `MissingInternalPOI`, `MissingExternalPOI` | `PENDING` |
| `Spent` with a raw `Valid` status | `SPENDABLE` as historical eligibility |
| `Spent` without `Valid` | `UNKNOWN`, preserving prior spendability if PPOps observed it |

`matchStatus`:

- `UNMATCHED`: no local intent for the opaque reference.
- `MATCHED`: reference, chain and token match.
- `CONFLICT`: the reference exists, but chain or token differs.

A settlement contributes value only while `MATCHED`, `FINALIZED` and
`SPENDABLE`.

## Intent projection

Intent state is recalculated transactionally from settlements rather than
maintained as an independent state machine. Atomic integer strings are converted
to JavaScript `bigint` for all sums and comparisons.

| Condition | Status |
| --- | --- |
| no credited value, before expiry | `OPEN` |
| credited value is positive and below expected | `PARTIAL` |
| credited value reaches expected; crossing settlement timestamp is not late | `PAID` |
| no credited value at/after expiry | `EXPIRED` |
| crossing settlement block timestamp is after expiry | `PAID_LATE` |

Overpayment is `max(received - expected, 0)`. Pending matched value is reported
separately and never counted as received.

## Idempotency and event delivery

Intent creation requires an `Idempotency-Key`. SQLite stores a SHA-256 request
fingerprint and the resulting intent in the same transaction. Identical retries
return the original intent; reuse with a changed request is rejected.

SQLite uniqueness enforces one settlement row per stable identifier. Immutable
identity fields are compared on rediscovery; a collision with different data is
rejected. Projection recalculation, revision increment and outbox insertion run
inside one SQLite transaction.

Event IDs are deterministic SHA-256-derived identifiers over a persisted dedupe
key. Event ordering uses SQLite insertion order when timestamps match. Events do
not include `externalReference`.

For the optional outbound webhook:

```text
signature = HMAC-SHA256(key, timestamp + "." + keyId + "." + eventId + "." + rawPayload)
```

Deliveries include a configured key ID for receiver-side rotation. An
authenticated endpoint can reschedule one explicitly selected dead-lettered
event; it cannot change the webhook URL or replay an event that is still live.

The controlled pilot receiver persists event IDs and counts duplicate delivery
attempts per event type without retaining payloads. `mainnet-gate-replay` reconstructs and
freshly signs the single confirmation event, then fails unless the receiver
recognizes it as an identical persisted event. Three API-token-keyed redacted
snapshots bind the paid state before restart, after restart and from an isolated
restore; the final verifier requires distinct daemon instances and stable
intent, settlement and confirmation fingerprints. Every capture also requeries
the receipt and block through the configured RPC quorum and checks the current
finalized height. The resulting redacted
report is EIP-191 signed with the existing merchant identity key for public
verification against the independently distributed signer. Operator snapshots
retain exact amounts and timestamps and are private evidence; only the final
metadata-minimal report is intended for publication.

The URL exists only in operator configuration. There is no registration API.
Non-loopback HTTP URLs are rejected; remote delivery requires HTTPS. Failed
events use exponential retry and become dead-lettered at the configured maximum.

## Storage and recovery

- PPOps intents/projections/settlements/outbox: SQLite with WAL, foreign keys and
  `synchronous=FULL`.
- RAILGUN engine/wallet state: LevelDOWN using the pinned SDK and a file-provided
  32-byte encryption key.
- Viewing key and every service key: separate mode-`0600` file, never returned by
  API or application logs.
- Runtime lock: prevents a second daemon and makes offline backup fail closed.

Backup uses SQLite's backup API only after verifying the daemon is stopped,
recursively copies the encrypted LevelDB and wallet state, inventories every
file with SHA-256 and records high-entropy secret fingerprints. Secret values
are excluded unless the operator explicitly supplies `--include-secrets`.
Restore validates inventory, network/token and secret identity; forced restore
moves prior files aside instead of deleting them.

## Tested surfaces and measurements

Pinned dependencies:

```text
@railgun-community/wallet        10.9.0
@railgun-community/engine         9.6.0
@railgun-community/shared-models  8.0.1
@railgun-community/waku-broadcaster-client-node 9.1.1 # payer only
ethers                            6.14.3
```

Primitive gate:

- Controlled RAILGUN V2 1-input/2-output Groth16 transfer on a local Hardhat
  chain: memo/token/amount/output identity/PPOI recovered by the view-only
  receiver and spending rejected.
- Live Sepolia fixture: 70 ERC-20 TXOs and real PPOI-derived buckets; test-only
  journal emitted two memo outputs on first run and zero on restart.

Verification evidence:

- Public CI run
  [`33335378295`](https://github.com/danelerr/ppops/actions/runs/33335378295)
  passed both `verify` and `docker` for commit `835e792`, including the final
  populated-calldata simulation remediation and documentation.
- Automated merchant suite on 2026-08-30: 19 test files and 58 tests, including
  1,000 property-based runs across reconciliation conservation/order invariance
  and opaque memo round trips. Enforced V8 coverage is 67.54% statements,
  62.74% branches, 72.23% functions and 70.38% lines across all `src/**/*.ts`;
  core database,
  reconciliation, descriptor and webhook paths are substantially higher than
  the RAILGUN engine wrapper that requires the live gate.
- Automated reference-payer suite on 2026-08-30: 15 test files and 79 tests,
  including request freshness, self-signed/Broadcaster transaction bounds,
  pre-Waku nullifier journaling, reported-versus-canonical hash separation,
  adversarial hash mismatch, proof-compatible quote rotation,
  exact-submission-quote persistence, classified rejection/ambiguity,
  exact-nullifier bounded retries, alternate-Broadcaster exclusion,
  cross-intent nullifier collision rejection, bounded RPC reads, gas outlier
  handling, exact populated-calldata simulation quorum, receipt agreement,
  prepare-time nullifier admission, no-broadcast preparation and clean
  CLI-process termination.
- Dry-run npm tarballs contained no secret/config/data paths; the merchant
  tarball contained no payer runtime and was limited to `dist`, package metadata,
  README and license files.
- Clean tarballs for both packages were installed outside the repository and
  their npm-generated binaries executed. This exposed and then verified the fix
  for the merchant CLI's former symlink-sensitive direct-execution guard.
- Arbitrum quorum preflight against two public RPC origins: chain ID `42161`,
  latest block `499967929`, finalized block `499964670`; both providers agreed
  on the conservative finalized block and its hash.
- A later three-origin profile passed chain/finality preflight with 2-of-3
  majority semantics. The payer subsequently synchronized and completed the
  same bounded no-broadcast preparation in 6.3 seconds; no submission record was
  created. This is fault-tolerance evidence for that run, not an availability
  SLA or proof of provider organizational independence.
- PPOI preflight against the community aggregator documented by the Wallet SDK:
  `1/1` node returned the exact `ppoi_health` JSON-RPC success response on
  2026-08-30. This proves reachability at that time, not future availability or
  independence.
- Fresh strict Sepolia scan from the public fixture viewing key: 21.2 seconds,
  zero PPOps-format references as expected.
- Restart scan against the same encrypted LevelDB: 9.9 seconds, zero duplicate
  reconciliation events.
- Local API: unauthenticated operational request returned 401; intent creation
  returned 201; descriptor verification returned valid; webhook registration
  route returned 404; SIGINT completed graceful shutdown.
- Loopback pilot receiver: the first correctly signed event returned `204` with
  `idempotent-replayed: false`; an identical retry returned `204` with
  `idempotent-replayed: true`; `/stats` retained exactly one
  `payment.confirmed` event and no payload.
- Mainnet evidence tooling: authenticated redacted snapshots passed across
  three distinct test daemon identities and separate restore origin; modified
  state, reused instances and raw invoice/reference/transaction leakage were
  rejected.
- Offline state backup completed and produced an integrity manifest.
- Controlled Arbitrum mainnet self-pilot: after the no-broadcast preparations,
  one approved `0.01 USDC` transaction mined once with a populated maximum gas
  cost of `54267840000000` wei under a `0.001 ETH` ceiling. PPOps first recorded
  `CONFIRMED + PENDING + MATCHED`, then `FINALIZED + SPENDABLE + MATCHED ->
  PAID` after the payer submitted its output PPOI. Exact-once webhook replay,
  restart and an isolated restore all passed.
- Non-financial Gate B preflight: the pinned Waku client became ready in about
  twelve seconds, found at least five LightPush and at least five Filter peers, and selected a
  native-USDC quote with observed reliability between `0.84` and `1` and roughly
  five to nine minutes remaining. The
  command loaded no wallet or EVM key, generated no proof and submitted no
  payment.
- Non-financial Gate B full preparation: the payer generated a proof for a
  `10000`-atomic (`0.01 USDC`) request, obtained a `1226761` gas estimate with
  three-provider agreement and observed an exact `70373`-atomic (`0.070373
  USDC`) Broadcaster fee at `0.84` reliability. A lower `50000`-atomic ceiling
  had already rejected the quote safely before proof. The passing preparation
  submitted no payment, wrote no journal record and left the intent open at
  zero received. The fee is point-in-time evidence, not a later quote. The
  value-bearing Gate B remained unproven at this stage.
- Post-trial no-send diagnosis: the pre-proof SDK estimate was `1128365`, and
  all three configured RPCs accepted the exact final populated calldata at an
  upper-median `1123239` estimate. The point-in-time fee was `64892` atomic
  (`0.064892 USDC`). The run submitted no payment and wrote no journal. This
  narrows the failed value-bearing path to off-chain Broadcaster processing or
  its sanitized response boundary; it does not pass Gate B.
- Prepare-time reservation diagnosis: a later fresh-intent proof selected at
  least one nullifier from the unresolved lineage. The read-only journal check
  returned `SUBMISSION_ALREADY_RECORDED` before final simulation, Waku or a new
  journal record. Existing Wallet SDK `Spendable` balance is therefore not
  treated as safe fresh-input capacity.
- Controlled value-bearing Gate B trial: one initial Waku submission and three
  bounded same-nullifier variants used fee quotes between `0.058867` and
  `0.071154 USDC`, each below the operator's `0.08 USDC` ceiling. The first
  three attempts addressed one Broadcaster identity. The final retry observed
  18 valid quotes from 14 unique identities, excluded the prior identity and
  selected a second. Both attempted identities returned post-send failures
  without a reported transaction hash; one was the upstream-sanitized
  `UNKNOWN_ERROR`, while another remained an unclassified client/transport
  failure. Final wallet synchronization more than 15 minutes after the last
  attempt found no canonical transaction for the reserved nullifiers; the
  private balance remained `0.1895 USDC` and the merchant intent remained open
  with zero received/pending value.
  The retry cap is exhausted, the nullifiers remain reserved, no fee was
  observed as charged and Gate B is **not passed**.
- After moving to one explicit scan owner, the merchant reached readiness in
  approximately 6 seconds and, after the final observability correction,
  completed five subsequent scheduled scans at roughly 34-second cadence.
  Earlier transient RPC-quorum failures had been mislabeled `STORAGE_LOCKED`
  because the classifier matched `lock` inside the word `block`; no LevelDB
  lock failure was established.

These measurements use public third-party RPC/PPOI endpoints and are not latency
SLOs. The fresh mainnet payment is a controlled self-pilot, not an independent
merchant run or an availability benchmark.

## Reproducible evidence

```bash
npm run verify
```

Machine-readable reports:

- `artifacts/primitive-gate-report.json`
- `artifacts/privacy-report.json`
- `artifacts/mainnet-gate-report.json`

## Dependencies and residual operational risk

The pinned RAILGUN packages are a large security-sensitive dependency. As of
this snapshot, compatible transitive overrides reduce the merchant
`npm audit --omit=dev` to 36 findings (6 moderate, 30 low) and the separate
Waku-enabled payer to 40 findings (10 moderate, 30 low); both have zero
critical/high findings. Overrides cover
Axios, WebSocket, form-data, tar, cookie/query parsers and YAML/object setters.
The runtime, privacy gate and test suite pass with the override set. Legacy
`web3 -> web3-bzz -> swarm-js`, wallet GraphQL/React-Native packages and the
Waku transport tree remain present, so package presence is still a supply-chain
and future-reachability risk. CI rejects high/critical
production findings and exports a CycloneDX SBOM. Blind `npm audit fix --force`
would still propose incompatible RAILGUN changes and is not applied.

The pinned SDK's historical refresh defers the event consumed by
`awaitWalletScan`, while its listener poller may schedule delayed TXID work.
PPOps therefore does not combine those two completion models: it pauses the SDK
listener poller, owns explicit refresh scheduling and reads current TXO/PPOI
state after `refreshBalances`. The daemon drains its active refresh before
LevelDB shutdown. The payer performs the same clean shutdown, flushes output,
then terminates prover worker threads that otherwise keep a finite CLI alive.
These lifecycle assumptions must be revalidated on every SDK upgrade.

Operational progress treats an SDK `Complete` scan event as ratio `1` even when
the wrapper omits its numeric progress field. RPC quorum disagreement is exposed
as `RPC_QUORUM`, not as a storage fault. Every quorum read gets one bounded retry;
persistent disagreement still fails closed and the next owned scan retries
without loosening finality or accepting a single-provider answer.

Docker packaging is built in CI. The Node base image is digest-pinned, GitHub
Actions are SHA-pinned, and a tag-triggered workflow first requires
`v<package version>`, then publishes version and commit-addressed GHCR images.
The release records the immutable image digest and attaches both SBOMs and the
primitive, privacy and Mainnet Gate reports. Release CI parses both generated
SBOMs and requires their expected root component plus a nonempty CycloneDX
component inventory, even when the generator tolerates known overridden
transitive-tree warnings. Compose bounds memory, CPU and PID usage; the
production runbook defines readiness, metrics, alert and egress policy.

Public GitHub Actions
[run `33333725083`](https://github.com/danelerr/ppops/actions/runs/33333725083)
passed both the full verify job and the Docker build job for implementation
commit `5d5752b` on 2026-08-30. This proves that commit's CI build, not the
still-pending tag-triggered GHCR publication.
