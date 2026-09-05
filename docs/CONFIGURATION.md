# Configuration reference

PPOps reads JSON from --config, default ./ppops.config.json. All relative storage
and secret paths resolve against the configuration file's directory, not the
shell's working directory. init writes portable relative secret paths.

Generate a config using init; [the container example](../config/ppops.docker.example.json)
shows all deployment sections. config and secrets must be owner-owned regular
files with no group/other permissions (0600 on Unix); directories should be 0700.

## Sections

| Section | Required inputs and defaults |
| --- | --- |
| schemaVersion | 1 |
| server | host 127.0.0.1, port 8787, allowRemote false |
| network | RAILGUN name, chain ID, token address/symbol/decimals, RPC URLs, deployment block and finality |
| storage | Distinct SQLite, LevelDB, proving-artifact and wallet-state paths |
| secrets | Separate API token, merchant identity key, DB encryption key and viewing-key files; HMAC when using webhooks |
| scanner | intervalMs 30000; PPOI URLs; providerPollingIntervalMs 10000; rpcTimeoutMs 20000; maxRpcBlockLag 5 |
| webhook | Optional fixed destination; keyId; timeoutMs 10000, maxAttempts 12, baseRetryMs 5000, maxRetryMs 3600000 |

The Arbitrum profile enforces chain 42161, native USDC
0xaf88d065e77c8cc2239327c5edb3a432268e5831, symbol USDC and 6 decimals.
It requires finalized-block finality, distinct RPC origins and at least one
PPOI endpoint. Two origins must both agree; three allow a 2-of-3 majority.
Distinct origins are checked mechanically; independent administration is the
operator's responsibility.

The operator selects providers and PPOI nodes. URLs can contain provider API
credentials, so keep the configuration private. Remote PPOI/webhook URLs require
HTTPS. Remote binding requires allowRemote: true and an appropriate network policy.

## Scanning

finalizedRecheckSeconds defaults to 604800 (seven days).
scanStallThresholdMs defaults to 1200000 (twenty minutes without a progress update).
maxScanStalenessMs written by init is 900000 (fifteen minutes); without an explicit
value, runtime uses the larger of fifteen minutes and three scan intervals.

A scan starts only after the preceding one finishes. The SDK's active scan
cannot be cancelled. Readiness requires a complete successful scan that has not
become stale; configuration validation alone does not establish readiness.

## Paths and secrets

Storage and secret paths must be distinct and non-overlapping. Changing a
viewing key while reusing wallet state is an identity change and is rejected.

| File | What it authorizes |
| --- | --- |
| api-token | Calls to the private merchant API |
| merchant-signing-key | Merchant identity signatures, not RAILGUN spending |
| railgun-db-encryption-key | Opening the encrypted scan database |
| merchant.viewing-key | Viewing the receiver's private history |
| webhook-hmac-key | Authenticating outbound events |

Use doctor --offline to identify the failing file by its configuration field.
It never prints secret values. It checks file metadata and basic format; wallet
decoding/import happens on startup. Use preflight for dependencies, then status
to observe runtime readiness.

## Configuration changes

Back up before changing identity or storage. Edit the private config, validate,
preflight and restart. The daemon does not hot-reload secrets. For API/HMAC
rotation and downtime planning, follow [the runbook](PRODUCTION-RUNBOOK.md).
