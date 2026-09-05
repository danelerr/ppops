# Troubleshooting workflow

Start with non-destructive evidence:

~~~bash
skills/ppops/scripts/doctor.sh --repo . --config ./ppops.config.json --offline
node dist/cli.js preflight --config ./ppops.config.json
skills/ppops/scripts/smoke-test.sh --api-token-file ./secrets/api-token
~~~

## Common failures

### Config or secret rejected

Require regular, non-symlink, owner-only files. Use chmod 600 on the exact file;
do not weaken PPOps file checks. Confirm storage and secret paths do not overlap.

### Preflight fails

Check chain ID, unique RPC origins, finalized-tag support, provider agreement,
and PPOI health. Do not reduce the quorum or switch providers silently. Capture
stable PPOps error codes; do not publish credential-bearing provider URLs.

### /v1/live passes but /v1/ready returns 503

The process exists but reconciliation is not safe yet. Inspect the minimal
health state and structured redacted logs. Wait for the current scan; the first
historical sync can be long. Do not start a second process against the same
LevelDB.

### Payment remains partial or pending

Inspect the authenticated intent and settlement dimensions. Typical causes are
underpayment, expiry, non-finalized chain state, ShieldPending,
MissingExternalPOI, or an unmatched/invalid memo. Never override the state.

### Webhook is not delivered

Confirm the configured receiver, TLS/network reachability, HMAC key/key ID,
timestamp policy, and HTTP status. Inspect /v1/outbox. Replay only an
investigated dead-letter through the authenticated replay endpoint.

### Payer submission is ambiguous

Use the payer submission journal and documented recovery command. Never delete
the journal or issue a blind second payment. A Waku-reported hash is not
canonical until nullifier-based recovery confirms it.

### Backup fails

Stop PPOps and allow any scan to drain. Backups are offline and fail closed
while the runtime lock exists. Do not copy a live LevelDB directory.

Escalate with redacted error codes, versions, state dimensions, and timing. Do
not include wallet material, addresses, references, transaction hashes, invoice
metadata, or credential-bearing URLs.
