# PPOps v0.1-R operational profile

Date: 2026-08-23

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
ethers                            6.14.3
```

Primitive gate:

- Controlled RAILGUN V2 1-input/2-output Groth16 transfer on a local Hardhat
  chain: memo/token/amount/output identity/PPOI recovered by the view-only
  receiver and spending rejected.
- Live Sepolia fixture: 70 ERC-20 TXOs and real PPOI-derived buckets; test-only
  journal emitted two memo outputs on first run and zero on restart.

Verification evidence:

- Automated merchant suite on 2026-08-29: 17 test files and 52 tests, including
  1,000 property-based
  runs across reconciliation conservation/order invariance and opaque memo
  round trips. Enforced V8 coverage is 64.63% statements, 60.60% branches,
  68.59% functions and 67.39% lines across all `src/**/*.ts`; core database,
  reconciliation, descriptor and webhook paths are substantially higher than
  the RAILGUN engine wrapper that requires the live gate.
- Arbitrum quorum preflight against two public RPC origins: chain ID `42161`,
  latest block `497581203`, finalized block `497576372`; both providers agreed
  on the conservative finalized block and its hash.
- PPOI preflight against the community aggregator documented by the Wallet SDK:
  `1/1` node returned the exact `ppoi_health` JSON-RPC success response on
  2026-08-23. This proves reachability at that time, not future availability or
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

These measurements use public third-party RPC/PPOI endpoints and are not latency
SLOs. The live fixture had no fresh strict PPOps payment; the actual exact memo
and `Valid -> Spendable` result comes from controlled RAILGUN primitives and the
official test PPOI interface documented in the primitive gate.

## Reproducible evidence

```bash
npm run verify
```

Machine-readable reports:

- `artifacts/primitive-gate-report.json`
- `artifacts/privacy-report.json`

## Dependencies and residual operational risk

The pinned RAILGUN packages are a large security-sensitive dependency. As of
this snapshot, compatible transitive overrides reduce `npm audit --omit=dev` to
36 findings: zero critical, zero high, 6 moderate and 30 low. Overrides cover
Axios, WebSocket, form-data, tar, cookie/query parsers and YAML/object setters.
The runtime, privacy gate and test suite pass with the override set. Legacy
`web3 -> web3-bzz -> swarm-js` and wallet GraphQL/React-Native packages remain
present even where PPOps does not exercise their features, so package presence
is still a supply-chain and future-reachability risk. CI rejects high/critical
production findings and exports a CycloneDX SBOM. Blind `npm audit fix --force`
would still propose incompatible RAILGUN changes and is not applied.

The SDK also leaves timeout resources scheduled after graceful cleanup. The
daemon performs bounded cleanup and the finite CLI exits afterward. Both issues
must be reassessed before a production claim or SDK upgrade.

Docker packaging is built in CI. The Node base image is digest-pinned, GitHub
Actions are SHA-pinned, and a tag-triggered workflow publishes version and
commit-addressed GHCR images. Compose bounds memory, CPU and PID usage; the
production runbook defines readiness, metrics, alert and egress policy.
