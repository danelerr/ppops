# Independent pilot workflow

The repository docs/EXTERNAL-PILOT.md is authoritative. Use a published,
immutable release and record consent before collecting evidence.

## Preferred Track A: independent merchant

The external operator:

1. controls the PPOps host and merchant receiver;
2. supplies only their merchant viewing-key file;
3. configures their own RPC/PPOI/webhook dependencies;
4. validates, preflights, and starts the daemon;
5. creates a low-value intent;
6. receives a separate payer's private transfer;
7. verifies one exact-once webhook and signed metadata-minimal report;
8. supplies candid operational feedback.

This demonstrates independent merchant-daemon operation.

## Track B: independent payer

The external operator runs only the reference payer against a merchant request.
This demonstrates payer interoperability, not merchant adoption. Describe it
accordingly.

## Evidence boundary

Collect only what the operator explicitly consents to publish, such as:

- release/version and report verification result;
- role and independently controlled environment;
- high-level completion/failure state;
- redacted latency/reliability measurements;
- qualitative feedback and permission to attribute it.

Never collect mnemonic/viewing/spending keys, wallet/database backups, EVM or
0zk addresses, transaction hashes, memo references, order/customer IDs, raw
request URLs, RPC credentials, or unrestricted logs.

One external pilot is evidence of independent use, not a production-readiness
claim. Preserve failed or abandoned pilots as honest, privacy-safe findings.
