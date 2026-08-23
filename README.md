# PPOps

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
- Localhost binding and Bearer authentication by default.
- Optional outbound-only HMAC-SHA256 webhook with retries and dead lettering.
- Offline backup/restore for SQLite, encrypted RAILGUN LevelDB and, only when
  explicitly requested, recovery secrets.

There is no UI, Request Network adapter, HPKE, generic rail framework, Solidity
contract or new cryptography in v0.1. Hardhat is not a product dependency; the
patches under `patches/` only preserve the controlled upstream gate.

## Requirements

- Node.js 22 or newer (the tested runtime is Node 24).
- A RAILGUN shareable viewing key for the merchant receiver.
- RPC and PPOI endpoints for the configured RAILGUN network.
- The address and decimals of the single ERC-20 token accepted by this instance.

The viewing key is confidential financial metadata even though it cannot spend.
Store it in a mode `0600` file. Do not pass a mnemonic or spending key to PPOps.

## Install and initialize

```bash
npm ci
npm run build

node dist/cli.js init \
  --config ./ppops.config.json \
  --viewing-key-file /secure/path/merchant.viewing-key \
  --token-address 0xYourStablecoinAddress \
  --token-symbol USDC \
  --token-decimals 6 \
  --rpc-url https://your-rpc.example \
  --poi-node https://your-poi-node.example
```

`init` creates an API token, an independent merchant EIP-712 signing key and a
RAILGUN database-encryption key as separate files. It prints the merchant signer
address, which payers must obtain through an independently trusted channel.

Validate and start:

```bash
node dist/cli.js config-validate --config ./ppops.config.json
node dist/cli.js serve --config ./ppops.config.json
```

The server binds to `127.0.0.1:8787` by default. The unauthenticated health route
reveals only readiness; every operational route requires the configured Bearer
token.

## API

Create an intent:

```http
POST /v1/intents
Authorization: Bearer <local API token>
Content-Type: application/json

{
  "externalReference": "INV-9248",
  "amountAtomic": "500000000",
  "expiresAt": 1787486400
}
```

The response includes a signed `PPOpsPaymentDescriptorV1`, the receiver's 0zk
address and `ppops:v1:0x<32-byte-reference>` memo. The descriptor uses the EIP-712
domain `PPOps Payment Descriptor`, version `1`, and is verified against the
merchant signer known out of band—not merely the signer embedded in the
descriptor.

Available routes:

| Method | Route | Authentication |
| --- | --- | --- |
| `GET` | `/v1/health` | none; minimal response |
| `POST` | `/v1/intents` | Bearer |
| `GET` | `/v1/intents` | Bearer |
| `GET` | `/v1/intents/:id` | Bearer |
| `GET` | `/v1/intents/:id/status` | Bearer |
| `GET` | `/v1/settlements` | Bearer |
| `GET` | `/v1/events` | Bearer |
| `GET` | `/v1/outbox` | Bearer |
| `POST` | `/v1/descriptors/verify` | Bearer |

There is deliberately no endpoint for registering arbitrary webhook URLs.

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
PPOps-Signature: v1=<hex HMAC-SHA256>
```

Verify the signature over:

```text
timestamp + "." + eventId + "." + rawRequestBody
```

Events contain local intent IDs and settlement state, but not
`externalReference`. Delivery is idempotent by event ID; non-2xx responses are
retried with exponential backoff.

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

`verify` runs the type checker, all tests, the production build and the
executable privacy-conformance report in one reproducible command.

`privacy:test` creates an actual RAILGUN V2 encrypted note locally, decrypts it
with an authorized view-only receiver, checks that the opaque reference and memo
are absent from the public commitment leaf, and exercises commercial canaries
through descriptor, log and event paths. Its machine-readable result is
`artifacts/privacy-report.json`.

The earlier gate evidence is in `docs/PRIMITIVE-GATE.md` and
`artifacts/primitive-gate-report.json`. The complete runtime semantics and
measurements are in `docs/OPERATIONAL-PROFILE.md`.

## Security status and known limits

- A viewing-key compromise reveals receiver balances, history, memos and the
  payment graph; view-only is non-custodial, not low-sensitivity.
- RPC/POI operators can observe requests and timing. PPOps does not provide
  network-layer anonymity.
- A compromised merchant host can read local commercial metadata and viewing
  material and can forge descriptors with the merchant identity key.
- RAILGUN SDK `10.9.0` / engine `9.6.0` are pinned because the gate relies on a
  direct TXO surface. Their large transitive dependency graph currently produces
  npm audit findings, including critical findings in legacy Web3/BZZ packages.
  This beta isolates the SDK but does not claim those findings are remediated.
- The pinned SDK leaves timeout resources after cleanup; the CLI forces process
  termination only after bounded graceful shutdown.
- Docker files are supplied, but the local development environment used for this
  snapshot had no Docker binary; CI is the intended build verification.

See `SECURITY.md` and `docs/ppops-threat-model.md` before exposing PPOps beyond
the documented single-merchant, local/private deployment.

## License

Apache-2.0. See `LICENSE`.
