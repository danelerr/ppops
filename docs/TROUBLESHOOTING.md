# Troubleshooting

Start with the command that matches the symptom. Keep payment eligibility,
provider quorum and secret-file checks intact while resolving the cause.

| Symptom | First check |
| --- | --- |
| Missing build or command | npm ci; npm run build; node dist/cli.js --help |
| Configuration rejected | node dist/cli.js doctor --config PATH --offline |
| Network or PPOI failure | node dist/cli.js preflight --config PATH |
| Daemon not ready | node dist/cli.js status --config PATH |
| Order not delivered | Authenticated intent/status, then outbox and your receiver |
| Payer submission ambiguous | Payer submission-status and recover-broadcaster |

## I checked out beta.1 and demo/doctor is missing

These commands are new in the unreleased beta.2 source. Use the complete source
checkout that contains these guides. Do not combine documentation from one
revision with a different release.

## I cannot find dist/cli.js

Run npm ci and npm run build from the merchant repository root. Node 24 is the
tested runtime; Node 22+ is the declared engine range. Native dependencies may
need a compiler toolchain on a platform without compatible prebuilds.
The [Docker path](DEPLOYMENT.md) includes the build toolchain.

The merchant does not need the payer package installed to start or run the demo.

## INVALID_ARGUMENT

Use node dist/cli.js COMMAND --help. Errors include a safe hint and, for known
options, a field. Both --name value and --name=value are supported.
Custom test-network initialization must specify the network and token explicitly.

## INVALID_INPUT, CONFIG_INVALID or FILE_UNAVAILABLE

doctor --offline checks each secret separately. For the named field check:

- the file exists, is regular, is not a symlink and belongs to the current user;
- config and secrets have no group/other permissions (0600);
- the container uses the same UID/GID as its mounted files;
- paths resolve relative to the config directory and do not overlap;
- secret contents have the expected format, with no surrounding export text.

Use [Configuration](CONFIGURATION.md) for the field's type and profile.
A file-format check is not a wallet import. A wrong viewing export can still
fail when the RAILGUN SDK imports it at serve startup.

init refuses existing files. To resume, use serve with the existing config.
After a partially failed initialization, inspect the instance and preserve its
identity/secret files before deciding whether to recreate it.

## PREFLIGHT_FAILED

Check provider credentials, chain ID, finalized-tag support, response time and
height agreement. Two configured RPCs must both agree; three need a majority.
Do not lower quorum to mask an unavailable provider.

At least one configured PPOI node must answer the compatible ppoi_health check.
PPOI is an external dependency chosen by the operator.

## The process is live but not ready

Engine initialization happens before the HTTP server opens. Once live, the
daemon still needs a complete scan. status reports scan activity, stalling and
consecutive failures. The first historical scan may exceed common startup
windows. Observe progress before assuming a stall.

A failed or stale scan makes readiness false. A prior healthy instance can
become degraded. Do not route new payment traffic until a fresh scan succeeds.
Use SIGTERM to stop; allow the active SDK scan to finish. Do not run a second
daemon, scan-once or backup against the same state.

## INVALID_REQUEST or INVALID_INTENT

Inspect error.field, error.hint or error.issues. Common corrections:

- use amountAtomic as a positive integer **string**, not a floating-point number;
- use a future expiresAt in **seconds**, not a copied fixed date or milliseconds;
- include only the three documented creation fields;
- provide a valid Idempotency-Key.

For IDEMPOTENCY_CONFLICT, compare with the saved original body. Recalculating
expiry while reusing the key causes a conflict. A timeout calls for an exact
retry, not a new key.

## Payment is OPEN, PARTIAL or EXPIRED

Check [payment states](PAYMENT-STATES.md). Pending matched value is not credited.
A partial payment remains PARTIAL after its expiry; inspect expiresAt separately.

Verify the payer used the correct private-transfer token, receiver and encrypted
memo. Freshly shielded funds may not yet be spendable. Finalized notes with
MissingExternalPOI may need the payer to complete output PPOI.

The checkout updates every five seconds while visible. A connection warning
means the displayed state may be stale. Request expiry is also shown locally.

## Webhook pending or dead-lettered

Inspect the authenticated /v1/outbox and your receiver's result. Check URL/TLS,
reachability, key ID, hex key decoding, clock skew and the exact raw body.
Acknowledge valid events you do not use for fulfillment as well as duplicates.

After repairing the receiver, POST /v1/outbox/:eventId/replay resets a
dead-lettered event. Already delivered and pending events return 409.
The mainnet-gate-replay CLI is different: it deliberately redelivers for pilot
evidence and is not ordinary recovery tooling.

## Backup or restore refuses to run

Stop the daemon and wait for scan shutdown. Backups are offline.
Default backups contain state and secret fingerprints, not secret values.
Restore into an isolated directory; --force preserves prior files under
timestamped pre-restore paths. See [Deployment](DEPLOYMENT.md).

## Share a useful support report

Include release/commit, Node/container version, command name, stable error code,
redacted check categories, timing and whether the issue repeats.

Keep viewing/spending keys, provider URLs, tokens, HMAC keys, request URLs,
transaction identifiers, commercial references and wallet databases private.
The structured doctor output is intended to help diagnosis without those values.
