# PPOps

[![CI](https://github.com/danelerr/ppops/actions/workflows/ci.yml/badge.svg)](https://github.com/danelerr/ppops/actions/workflows/ci.yml)

PPOps is an open-source, self-hosted RAILGUN payment reconciler. A merchant
creates a local payment intent, gives the payer a signed descriptor containing
an opaque reference, and receives a private RAILGUN transfer whose encrypted
memo carries that reference. PPOps detects and reconciles the transfer from a
view-only wallet; it never accepts a RAILGUN spending key or mnemonic.

This repository is **v0.1.0-beta.0**. The RAILGUN primitive gate and the daemon
flow run, but this is not a production-readiness claim. Review the known risks
before using real financial data.

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

There is no wallet custody, Request Network adapter, HPKE, generic rail
framework, Solidity contract or new cryptography in v0.1. Hardhat is not a
product dependency; the patches under `patches/` only preserve the controlled
upstream gate.

## Requirements

- Node.js 22 or newer (the tested runtime is Node 24).
- A RAILGUN shareable viewing key for the merchant receiver.
- At least two independently operated Arbitrum RPC origins and a production PPOI
  endpoint for a mainnet instance.
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
adapter has passed the mainnet gate. The current Railway Wallet source exposes a
private memo field and is the documented client for the controlled pilot; see
[`docs/PILOT-GUIDE.md`](docs/PILOT-GUIDE.md) for the exact receiver, payer and
evidence procedure.

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
container UID/GID can access them. The container listens on `0.0.0.0` internally,
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
build, executable privacy-conformance report and a production-dependency audit
that rejects high or critical findings. CI also emits a CycloneDX SBOM.

`privacy:test` creates an actual RAILGUN V2 encrypted note locally, decrypts it
with an authorized view-only receiver, checks that the opaque reference and memo
are absent from the public commitment leaf, and exercises commercial canaries
through descriptor, log and event paths. Its machine-readable result is
`artifacts/privacy-report.json`.

The earlier gate evidence is in `docs/PRIMITIVE-GATE.md` and
`artifacts/primitive-gate-report.json`. The complete runtime semantics and
measurements are in `docs/OPERATIONAL-PROFILE.md`. A beta using real funds must
follow `docs/PILOT-GUIDE.md` and complete `docs/MAINNET-GATE.md`; operations and
alerts are documented in `docs/PRODUCTION-RUNBOOK.md`.

## Security status and known limits

- A viewing-key compromise reveals receiver balances, history, memos and the
  payment graph; view-only is non-custodial, not low-sensitivity.
- RPC/POI operators can observe requests and timing. PPOps does not provide
  network-layer anonymity.
- A compromised merchant host can read local commercial metadata and viewing
  material and can forge descriptors with the merchant identity key.
- RAILGUN SDK `10.9.0` / engine `9.6.0` are pinned because the gate relies on a
  direct TXO surface. Compatible transitive overrides reduce the current
  production audit to 36 moderate/low findings and zero high/critical findings.
  The legacy Web3/BZZ and GraphQL tree remains large and is still supply-chain
  sensitive.
- The pinned SDK leaves timeout resources after cleanup; the CLI forces process
  termination only after bounded graceful shutdown.
- The base image and GitHub Actions are digest/SHA pinned. CI builds the Docker
  image, emits an SBOM and publishes immutable GHCR tags when a `v*` Git tag is
  deliberately pushed.

See `SECURITY.md` and `docs/ppops-threat-model.md` before exposing PPOps beyond
the documented single-merchant, local/private deployment.

## License

Apache-2.0. See `LICENSE`.
