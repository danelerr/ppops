# PPOps production runbook

This runbook applies to the v0.1 Arbitrum One + native USDC profile. A green
unit-test suite is not a substitute for completing the live gate in
`docs/MAINNET-GATE.md`.

## Trust boundaries and network policy

- Keep port `8787` bound to loopback. Put an authenticated TLS reverse proxy in
  front only when remote merchant access is required. Do not trust forwarded
  client-IP headers inside PPOps; enforce a second rate limit at that proxy.
- Permit outbound traffic only to the configured independent Arbitrum RPC
  origins, production PPOI origin, package/image registries used during a
  separate build phase, and the configured webhook origin. The running
  container does not need registry access.
- Use RPC providers under different administrative control. Two URLs at the
  same origin are rejected. PPOps requires both providers to agree; three
  providers tolerate one failed or inconsistent source.
- Mount the shareable viewing key, RAILGUN database key, merchant signer, API
  token and webhook HMAC key read-only from a secret manager or mode-`0600`
  files. The merchant signer is an identity key, not a RAILGUN spending key.
- Use encrypted disks and encrypted snapshots. SQLite contains the private
  mapping from merchant references to payment history.

## Before starting

1. Pin an immutable PPOps container digest and retain its CycloneDX SBOM from
   CI. Review all lockfile and RAILGUN SDK changes before upgrading.
2. Validate the config with `ppops config-validate`, then run `ppops preflight`.
   The latter verifies actual RPC chain ID, quorum and finalized-tag support
   plus PPOI JSON-RPC health without opening wallet secrets. Arbitrum mainnet refuses
   confirmation-count finality, non-native USDC, fewer than two RPC origins,
   and the documented test PPOI host.
   The Wallet SDK currently documents `https://ppoi.fdi.network` as a public
   community aggregator; using it creates an external availability/trust
   dependency. Evaluate that dependency or operate an independent compatible
   node before broad production use.
3. Restore a backup into an isolated directory and run the restore checks.
4. Verify the merchant signer through the merchant's independent identity
   channel. Do not teach customers to trust the signer displayed by checkout
   alone.
5. Keep at least 4 GiB RAM, 2 CPU cores and sufficient persistent storage for
   the RAILGUN LevelDB and SQLite WAL. The Compose profile enforces these
   process limits.

## Health and alerts

- `GET /v1/live` proves only that HTTP is alive.
- `GET /v1/ready` returns `503` until a full RAILGUN/PPOI scan succeeds and
  whenever the last success becomes stale. Use it for orchestration health.
- `GET /v1/metrics` requires the bearer token and returns metadata-free
  Prometheus metrics.

Page an operator when any of these conditions holds:

- `ppops_ready == 0` for 15 minutes;
- `ppops_scan_consecutive_failures >= 2`;
- `time() - ppops_last_scan_timestamp_seconds > 900`;
- `ppops_outbox_dead_lettered > 0`;
- `ppops_outbox_pending` grows for three scan intervals;
- RPC height disagreement appears in `scan.failed` logs;
- disk usage exceeds 75%, process RSS approaches the 4 GiB limit, or the
  container restarts.

Logs intentionally omit invoice identifiers, references, viewing material and
provider URLs. Preserve that property in log shipping.

## Safe shutdown

- Before planned maintenance, check `/v1/ready` and wait until
  `scanInProgress` is `false`. The RAILGUN Wallet SDK scan cannot be cancelled.
- On `SIGTERM`, PPOps stops accepting HTTP traffic and scheduling new scans, then
  drains any active scan before closing LevelDB, SQLite and the runtime lock.
  Do not impose a conventional 30-second kill window; the Compose profile grants
  30 minutes because an initial or recovery scan can be long.
- PPOps pauses the Wallet SDK listener poller and owns one explicit scan
  schedule. Do not add a second poller or another SDK process against the same
  LevelDB; the SDK's historical refresh and deferred wallet event are different
  completion models, and mixing them previously caused stalls and delayed TXID
  work after shutdown.
- A forced kill during a scan is an abnormal recovery event. Restart with the
  same state, wait for a complete successful scan and verify readiness before
  fulfilling payments or taking a backup.
- Backup and restore commands remain offline operations and refuse an active
  runtime lock. Never copy live LevelDB files as a substitute for the documented
  backup flow.

## Webhook recovery and key rotation

The repository's `pilot:webhook-receiver` is loopback-only evidence tooling. Do
not deploy it as the merchant's production fulfillment backend.

`mainnet-gate-replay` is likewise controlled-pilot tooling: it deliberately
resends the already delivered confirmation to prove durable receiver dedupe. Do
not use it as a routine production replay mechanism.

- Every delivery includes `ppops-event-id`, `ppops-timestamp`,
  `ppops-key-id`, and `ppops-signature`. Receivers must reject old timestamps
  and deduplicate event IDs before applying business state.
- Investigate the receiver before replaying. Then call
  `POST /v1/outbox/{eventId}/replay`; only a dead-lettered event can be reset.
- To rotate the HMAC key, configure the receiver to accept both old and new key
  IDs, atomically replace the secret file and `webhook.keyId`, restart PPOps,
  verify a new delivery, then remove the old receiver key.
- Rotate the API token by atomically replacing its file and restarting PPOps.
  Update clients before removing the old instance; v0.1 intentionally does not
  expose secret-rotation endpoints.

## Backup and incident response

- Back up SQLite, the encrypted RAILGUN LevelDB, wallet-state file and their
  corresponding secrets. A database without the `reference -> invoice`
  mapping cannot reconstruct merchant reconciliation from chain data alone.
- On suspected viewing-key exposure, stop the instance, preserve logs and
  snapshots, create a new receiver wallet outside PPOps, and treat the old
  receiver's complete private payment history as disclosed. Funds are not
  directly spendable with the viewing key.
- On suspected merchant-signer or API-token exposure, rotate the affected key,
  publish the new expected signer through the independent merchant identity
  channel, and invalidate outstanding descriptors if signer trust changed.
- On RPC/PPOI disagreement, do not manually mark intents paid. PPOps fails
  closed; restore provider agreement and rescan.
