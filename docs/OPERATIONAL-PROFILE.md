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

Finality is one operator-selected policy per instance:

- `finalized`: transaction block is at or below the RPC's finalized tag.
- `confirmations`: `latest - transactionBlock + 1` reaches the configured count.

Non-final persisted settlements are rechecked by transaction receipt so a TXO
that disappears from the wallet scan can be marked `REVERTED`.

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

SQLite uniqueness enforces one settlement row per stable identifier. Immutable
identity fields are compared on rediscovery; a collision with different data is
rejected. Projection recalculation, revision increment and outbox insertion run
inside one SQLite transaction.

Event IDs are deterministic SHA-256-derived identifiers over a persisted dedupe
key. Event ordering uses SQLite insertion order when timestamps match. Events do
not include `externalReference`.

For the optional outbound webhook:

```text
signature = HMAC-SHA256(key, timestamp + "." + eventId + "." + rawPayload)
```

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

Compiled daemon smoke test on 2026-08-23:

- Fresh strict Sepolia scan from the public fixture viewing key: 21.2 seconds,
  zero PPOps-format references as expected.
- Restart scan against the same encrypted LevelDB: 9.9 seconds, zero duplicate
  reconciliation events.
- Local API: unauthenticated operational request returned 401; intent creation
  returned 201; descriptor verification returned valid; webhook registration
  route returned 404; SIGINT completed graceful shutdown.
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
this snapshot, `npm audit --omit=dev` reports 66 transitive findings: 3 critical,
12 high, 35 moderate and 16 low. Critical paths originate in legacy
`web3 -> web3-bzz -> swarm-js` dependencies pulled by the pinned RAILGUN engine;
additional high findings originate in the wallet's GraphQL Mesh and Axios
trees. PPOps does not exercise BZZ functionality, but package presence remains a
supply-chain and future-reachability risk. PPOps overrides only the wallet's
Axios `1.7.2` with compatible `1.19.0`; the runtime and primitive gate pass with
that override. Blind `npm audit fix --force` proposes an incompatible RAILGUN
change and is not applied.

The SDK also leaves timeout resources scheduled after graceful cleanup. The
daemon performs bounded cleanup and the finite CLI exits afterward. Both issues
must be reassessed before a production claim or SDK upgrade.

Docker packaging is present but was not executable in the authoring environment
because Docker was unavailable. CI is configured to build the image on a Docker
capable runner.
