# PPOps

[![CI](https://github.com/danelerr/ppops/actions/workflows/ci.yml/badge.svg)](https://github.com/danelerr/ppops/actions/workflows/ci.yml)

PPOps brings a BTCPay Server-style, self-hosted payment model to private USDC on
RAILGUN. A merchant runs the PPOps daemon, creates signed payment intents through
its local API and receives an authenticated `payment.confirmed` webhook after
PPOps independently verifies the private settlement.

PPOps observes the merchant receiver through view-only access. The merchant
daemon never accepts a RAILGUN spending key or mnemonic, never receives the
payment on the merchant's behalf and never becomes a third-party payment
processor. Its lifecycle is intentionally familiar to developers who use
payment-intent APIs, while custody and infrastructure remain with the merchant.

This repository is **v0.1.0-beta.0**. The RAILGUN primitive gate and a controlled
Arbitrum mainnet self-pilot pass. Direct Waku/Broadcaster connectivity and a
complete no-send proof preparation also pass, but the value-bearing
Broadcaster gate and external adoption remain open. This is not a
production-readiness claim. Review the known risks before using real financial
data.

## Product model

The product is the long-running merchant daemon, not an SDK and not a payer
wallet:

```text
merchant application -> PPOps API -> signed payment intent
payer wallet -> RAILGUN private transfer with encrypted reference
PPOps view-only scanner -> finality + PPOI + matching
PPOps outbox -> payment.confirmed webhook -> merchant application
```

`tools/ppops-payer` is a separately executed reference client for the mainnet
gate. It demonstrates how a spending wallet consumes a PPOps request without
placing spending authority in the merchant daemon. A future `@ppops/sdk` would
only wrap the existing HTTP API; it is not required to integrate PPOps.

Available now:

- self-hosted daemon and authenticated REST API;
- signed, metadata-minimal payer request;
- view-only RAILGUN reconciliation;
- finality/PPOI-aware payment state;
- idempotent event IDs and HMAC-authenticated webhook delivery;
- reference payer with self-signed and Waku/Broadcaster submission modes;
- reproducible privacy/security evidence.

Possible after the remaining adoption gate, but **not implemented today**:

- merchant client SDKs;
- QR or consumer wallet checkout UX;
- WooCommerce or other commerce plugins;
- wallet-native PPOps descriptor support;
- additional networks, assets or privacy rails.

See [`docs/PRODUCT-MODEL.md`](docs/PRODUCT-MODEL.md) for the product boundary,
merchant integration example and current/future split.

## What v0.1 does

```text
merchant backend -> authenticated local API -> payment intent + EIP-712 descriptor
payer -> RAILGUN private ERC-20 transfer -> encrypted ppops:v1 reference
view-only scanner -> finality + PPOI + reference matching -> SQLite projection
outbox -> timestamped HMAC webhook -> merchant backend
```

- Exactly one configured RAILGUN network and one configured ERC-20 token per
  instance.
- Random 32-byte references; invoice, customer and order identifiers stay in
  local SQLite.
- Orthogonal `chainStatus`, `poiStatus` and `matchStatus` settlement state.
- Derived `OPEN`, `PARTIAL`, `PAID`, `EXPIRED` and `PAID_LATE` intent state,
  including overpayment accounting.
- Restart-safe settlement identity and transactional event outbox.
- Localhost binding, Bearer authentication and bounded in-process rate limits by
  default.
- An unguessable, metadata-minimal checkout URL and machine-readable payer
  request; it never accepts wallet secrets or submits a spend.
- Optional outbound-only HMAC-SHA256 webhook with retries and dead lettering.
- Offline backup/restore for SQLite, encrypted RAILGUN LevelDB and, only when
  explicitly requested, recovery secrets.

There is no wallet custody in the merchant daemon, Request Network adapter,
HPKE, generic rail framework, Solidity contract or new cryptography in v0.1.
Hardhat is not a product dependency; the patches under `patches/` only preserve
the controlled upstream gate.

## Repository layout

```text
src/                       merchant daemon; view-only RAILGUN reconciler
tools/ppops-payer/         independent payer-side mainnet-gate harness
scripts/                   privacy, primitive and operational checks
test/                      merchant-daemon regression/property tests
docs/                      threat model, runbooks and evidence policy
artifacts/                 metadata-minimal reproducible gate reports
```

The payer shares the repository for reproducibility, not a runtime. It has an
independent package, lockfile, encrypted database, configuration and secret
directory. The root TypeScript build and Docker image exclude it, and
`trust-boundary:check` rejects cross-boundary imports.

## Requirements

- Node.js 22 or newer (the tested runtime is Node 24).
- A RAILGUN shareable viewing key for the merchant receiver.
- At least two independently operated Arbitrum RPC origins and a production PPOI
  endpoint for a mainnet instance. Three RPC origins are recommended so the
  majority quorum can tolerate one unavailable or outlying provider; PPOps does
  not reduce the quorum to regain availability.
- Native Arbitrum USDC. The v0.1 production profile rejects other tokens,
  confirmation-count finality and the documented test PPOI host.

The viewing key is confidential financial metadata even though it cannot spend.
Store it in a mode `0600` file. Do not pass a mnemonic or spending key to PPOps.

The RAILGUN Wallet SDK currently documents `https://ppoi.fdi.network` as a
public community PPOI aggregator. It is an external availability/trust
dependency, not PPOps infrastructure. Operators may instead configure another
community node or a self-hosted compatible PPOI node; PPOps does not silently
select one.

## Install and initialize

```bash
npm ci
npm run build

node dist/cli.js init \
  --config ./ppops.config.json \
  --viewing-key-file /secure/path/merchant.viewing-key \
  --network Arbitrum \
  --token-address 0xaf88d065e77c8cC2239327C5EDb3A432268e5831 \
  --token-symbol USDC \
  --token-decimals 6 \
  --rpc-url https://your-first-rpc.example \
  --rpc-url https://your-independent-rpc.example \
  --rpc-url https://your-third-rpc.example \
  --poi-node https://your-production-poi.example
```

`init` creates an API token, an independent merchant EIP-712 signing key and a
RAILGUN database-encryption key as separate files. It prints the merchant signer
address, which payers must obtain through an independently trusted channel.

Validate and start:

```bash
node dist/cli.js config-validate --config ./ppops.config.json
node dist/cli.js preflight --config ./ppops.config.json
node dist/cli.js serve --config ./ppops.config.json
```

`preflight` verifies the configured chain ID and RPC quorum, including the
`finalized` tag, and requires at least one configured PPOI node to pass the
official `ppoi_health` JSON-RPC check. It does so without reading wallet secrets
or starting the RAILGUN engine, and does not print provider URLs.

The server binds to `127.0.0.1:8787` by default. Unauthenticated liveness and
readiness routes reveal only process/scan state; every operational or metrics
route requires the configured Bearer token.

## API

Create an intent:

```http
POST /v1/intents
Authorization: Bearer <local API token>
Idempotency-Key: merchant-order-9248
Content-Type: application/json

{
  "externalReference": "INV-9248",
  "amountAtomic": "500000000",
  "expiresAt": 1787486400
}
```

The response includes a stable `checkoutPath`, signed
`PPOpsPaymentDescriptorV1`, the receiver's 0zk address and
`ppops:v1:0x<32-byte-reference>` memo. Retrying the same idempotency key and body
returns the same intent; changing the body returns `409`. The descriptor uses the EIP-712
domain `PPOps Payment Descriptor`, version `1`, and is verified against the
merchant signer known out of band—not merely the signer embedded in the
descriptor.

Available routes:

| Method | Route | Authentication |
| --- | --- | --- |
| `GET` | `/v1/live` | none; liveness only |
| `GET` | `/v1/ready` | none; `503` until scan-ready |
| `GET` | `/v1/health` | none; minimal diagnostic state |
| `GET` | `/pay/:id` | none; unguessable payer checkout |
| `GET` | `/pay/:id/request.json` | none; metadata-minimal payment request |
| `POST` | `/v1/intents` | Bearer |
| `GET` | `/v1/runtime` | Bearer; redacted runtime/profile identity |
| `GET` | `/v1/intents` | Bearer |
| `GET` | `/v1/intents/:id` | Bearer |
| `GET` | `/v1/intents/:id/status` | Bearer |
| `GET` | `/v1/settlements` | Bearer |
| `GET` | `/v1/events` | Bearer |
| `GET` | `/v1/outbox` | Bearer |
| `POST` | `/v1/outbox/:eventId/replay` | Bearer; dead letters only |
| `GET` | `/v1/metrics` | Bearer; metadata-free Prometheus text |
| `POST` | `/v1/descriptors/verify` | Bearer |

There is deliberately no endpoint for registering arbitrary webhook URLs.

### Payer flow

The checkout is a safe handoff, not a custodial wallet. It shows the exact
recipient, native-USDC amount, encrypted memo and signed descriptor and exposes
the same data at `request.json`. The payer must use a separate RAILGUN spending
wallet or integration that supports private ERC-20 transfers with `memoText`:

1. obtain the expected merchant signer outside the checkout URL and verify the
   descriptor;
2. hold enough private native USDC for the amount and broadcaster fee;
3. generate the private transfer proof in the payer's wallet and submit it,
   normally through a RAILGUN Broadcaster;
4. keep every mnemonic, spending key and wallet-encryption key off the PPOps
   host.

PPOps intentionally does not provide a “connect wallet” button in v0.1. A
merchant cannot claim general consumer usability until its chosen payer wallet
adapter has passed the mainnet gate. The reference pilot payer is the separate,
minimal `ppops-payer` harness built directly on the official RAILGUN Wallet SDK.
It verifies `request.json`, imports a full payer only on the payer host and sends
the exact private ERC-20 transfer with `memoText`. Its Broadcaster mode pins fee
signers locally, bounds the token fee, journals nullifiers before Waku, derives
the canonical transaction hash from those nullifiers instead of trusting the
Broadcaster response, and does not load an EVM self-signing key. Railway Wallet
remains an optional manual compatibility client, not a critical PPOps
dependency. See
[`docs/PILOT-GUIDE.md`](docs/PILOT-GUIDE.md) for the evidence procedure.

## Settlement semantics

A detected note is not automatically a confirmed payment:

```text
observed != chain-finalized != PPOI-spendable != intent paid
```

PPOps credits a settlement only when all of these hold:

- its strict memo reference resolves to a local intent;
- chain, token and receiver context match;
- the configured finality policy marks the transaction `FINALIZED`;
- the PPOI-derived status is `SPENDABLE`.

The stable identifier discovered by the primitive gate is:

```text
chainId:txidVersion:normalizedPublicTransactionHash:tree:position
```

The reference is not used as an ID because one intent may receive multiple
partial settlements.

## Webhook verification

The configured endpoint receives the exact stored event JSON and these headers:

```text
PPOps-Event-Id: <event ID>
PPOps-Timestamp: <Unix seconds>
PPOps-Key-Id: <configured rotation ID>
PPOps-Signature: v1=<hex HMAC-SHA256>
```

Verify the signature over:

```text
timestamp + "." + keyId + "." + eventId + "." + rawRequestBody
```

Events contain local intent IDs and settlement state, but not
`externalReference`. Delivery is idempotent by event ID; non-2xx responses are
retried with exponential backoff.

`npm run pilot:webhook-receiver` starts a loopback-only reference receiver for
the controlled gate. It verifies signatures and timestamp freshness and stores
only event IDs, event types and payload hashes for durable deduplication. It is
not a production fulfillment backend; usage is documented in
[`docs/PILOT-GUIDE.md`](docs/PILOT-GUIDE.md).

## Backup and restore

Stop PPOps first. An active runtime lock makes online backup fail closed.

```bash
node dist/cli.js backup \
  --config ./ppops.config.json \
  --output ./backups/ppops-2026-08-23

node dist/cli.js restore \
  --config ./ppops.config.json \
  --input ./backups/ppops-2026-08-23
```

The default backup contains state and secret fingerprints, not secret values.
Back up the referenced secrets in your existing secret-management system. The
explicit `--include-secrets` option creates a mode-`0600` recovery bundle that
contains the viewing key and identity/authentication keys; protect that bundle
accordingly. `restore --force` moves existing targets to `*.pre-restore-*`
instead of deleting them.

The SHA-256 inventory detects accidental corruption; it is not a signature and
does not authenticate a backup supplied by an attacker. Store backups in an
authenticated, access-controlled system.

## Docker

Copy `config/ppops.docker.example.json` to `instance/ppops.config.json`, replace
every placeholder, create `instance/data` and `instance/secrets`, and ensure the
container UID/GID can access them. Keep the config and every secret file
owner-only (`chmod 600`); PPOps rejects symlinks, oversized files and group/other
permissions. The container listens on `0.0.0.0` internally,
while Compose publishes it only as `127.0.0.1:8787` on the host.

```bash
PPOPS_UID=$(id -u) PPOPS_GID=$(id -g) docker compose up --build
```

The image runs as non-root with a read-only root filesystem, all Linux
capabilities dropped and `no-new-privileges`. RPC, PPOI and an optional webhook
still require outbound network access.

## Verification

```bash
npm run verify
```

`verify` runs the type checker, coverage thresholds, all tests, the production
build, executable privacy-conformance checks and a production-dependency audit
that rejects high or critical findings. Its temporary privacy report is written
under ignored `coverage/`, so routine verification leaves tracked evidence
unchanged. CI also emits a CycloneDX SBOM.

To install and verify both independently built components:

```bash
npm run payer:install
npm run verify:all
```

CI publishes separate CycloneDX SBOMs for the merchant daemon and payer harness.

`privacy:test` refreshes `artifacts/privacy-report.json`, creates an actual
RAILGUN V2 encrypted note locally, decrypts it
with an authorized view-only receiver, checks that the opaque reference and memo
are absent from the public commitment leaf, and exercises commercial canaries
through descriptor, log and event paths. Its machine-readable result is
`artifacts/privacy-report.json`.

The earlier gate evidence is in `docs/PRIMITIVE-GATE.md` and
`artifacts/primitive-gate-report.json`. The complete runtime semantics and
measurements are in `docs/OPERATIONAL-PROFILE.md`. A beta using real funds must
follow `docs/PILOT-GUIDE.md` and complete `docs/MAINNET-GATE.md`; operations and
alerts are documented in `docs/PRODUCTION-RUNBOOK.md`.

The controlled mainnet pilot's observed onboarding/RPC limitations and current
evidence boundary are recorded in `docs/PILOT-FINDINGS.md`. The evidence-gated
public-good direction, proposed impact metrics and explicit Octant go/no-go are
in `docs/IMPACT-ROADMAP.md`. A third party can use
[`docs/EXTERNAL-PILOT.md`](docs/EXTERNAL-PILOT.md) to produce independently
verifiable evidence without publishing payment identifiers. None of these
documents expands the v0.1 product scope or converts a self-pilot into external
traction.

On 2026-08-30 the direct SDK payer first completed bounded no-broadcast runs,
then submitted one approved `0.01 USDC` private transfer under a `0.001 ETH`
gas ceiling. The transaction mined once; PPOps held the matched amount pending
until payer-side PPOI moved the receiver output from `MissingExternalPOI` to
`Valid`, then recorded `FINALIZED + SPENDABLE + MATCHED -> PAID`. Exact-once
webhook replay, restart and isolated restore passed. The signed, redacted result
is `artifacts/mainnet-gate-report.json`; this is still self-pilot evidence, not
external adoption.

The payer's separate
[`Gate B runbook`](tools/ppops-payer/docs/GATE-B.md) distinguishes the passing
non-financial Waku preflight and no-send proof preparation from the
still-pending value-bearing Broadcaster payment. Preparation is not
sender-unlinkability evidence.

The controlled pilot originally used Railway Wallet and retained its diagnostic
tooling as compatibility evidence. If testing that optional client, inspect
cache activity without opening or reading the wallet database:

```bash
npm run pilot:railway-sync-doctor -- --quiet-seconds 1200 --observe-seconds 30
```

`CACHE_ADVANCING` means IndexedDB changed during the observation window.
`RUNNING_NO_WRITE_OBSERVED` means Railway is open and its cache was written
recently, but that short sample did not prove advancement; computation between
writes is possible. `SUSPECTED_STALL` requires a running app with no cache write
for the configured twenty-minute threshold and remains unchanged during the
observation window. A single `PROLONGED_QUIET` snapshot is inconclusive;
the pilot observed a compute phase longer than ten minutes followed by a 43 MB
cache advance. `APP_NOT_RUNNING` is reported separately so a recent write
cannot be mistaken for live synchronization.
Railway `v5.24.21` also has a reproducible UI calculation that can leave
displayed progress near 50%; see
[`patches/railway-wallet-v5.24.21-scan-progress.patch`](patches/railway-wallet-v5.24.21-scan-progress.patch).

The mainnet gate CLI produces keyed, identifier-redacted operator snapshots before
restart, after restart and from an isolated restore. The snapshots still contain
amounts and timestamps and must remain private. It rejects changed settlement/event
state, reused daemon instances, an unisolated restore, missing webhook delivery
or missing receiver deduplication. Each capture also requeries every matched
transaction receipt and block hash through the configured RPC quorum and checks
that the stored block is under the current finalized height. It still cannot replace the real private
Arbitrum USDC transfer or operator records proving which processes were run. The
final metadata-minimal public report is signed by the merchant identity key and can be checked
with `mainnet-gate-report-verify` against the independently distributed signer.

## Security status and known limits

- A viewing-key compromise reveals receiver balances, history, memos and the
  payment graph; view-only is non-custodial, not low-sensitivity.
- RPC/POI operators can observe requests and timing. PPOps does not provide
  network-layer anonymity.
- A compromised merchant host can read local commercial metadata and viewing
  material and can forge descriptors with the merchant identity key.
- RAILGUN SDK `10.9.0` / engine `9.6.0` are pinned because the gate relies on a
  direct TXO surface. Compatible transitive overrides reduce the current
  merchant audit to 30 low and 6 moderate findings. The separate Waku-enabled
  payer has 30 low and 10 moderate findings. Both have zero high/critical
  findings. The legacy Web3/BZZ, GraphQL and Waku trees remain large and
  supply-chain sensitive.
- The pinned SDK can leave prover workers referenced after graceful cleanup.
  The daemon drains a non-cancellable active scan (with a 30-minute Compose
  grace window); the finite payer bounds provider/engine cleanup, flushes
  output, and exits explicitly. Retest this lifecycle on every SDK upgrade.
- `tools/ppops-payer` deliberately accepts payer spending authority, but it is
  excluded from the merchant build/container and must run on a payer-controlled
  host. Gate A's public self-signer is linkable by design.
- The base image and GitHub Actions are digest/SHA pinned. CI builds the Docker
  image, emits an SBOM and publishes immutable GHCR tags when a `v*` Git tag is
  deliberately pushed.

See `SECURITY.md` and `docs/ppops-threat-model.md` before exposing PPOps beyond
the documented single-merchant, local/private deployment.

## License

Apache-2.0. See `LICENSE`.
