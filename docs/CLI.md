# CLI reference

In a source checkout use node dist/cli.js after npm run build. A linked/installed
source package exposes ppops. The container entrypoint is the same CLI.

Use ppops --help, ppops --version, ppops COMMAND --help or ppops help COMMAND.
Options accept --name value and --name=value. Secret values belong in files.

## Everyday commands

| Command | Purpose |
| --- | --- |
| demo [--port 8788] | Isolated local order/payment simulation; no configuration needed |
| init --profile arbitrum-usdc … | Create one instance and its independent secrets |
| doctor [--offline] [--json] | Check config and each secret; online also checks dependencies and readiness |
| config-validate | Validate schema and path relationships, without wallet import |
| preflight | Check RPC chain/quorum/finality and PPOI health without wallet secrets |
| serve | Start the merchant daemon and scanner |
| status [--json] | Query local daemon health and next action |
| scan-once | Run one offline-owned scan; cannot share an active daemon's state |
| backup --output NEW_DIRECTORY | Stop first; default bundle excludes secret values |
| restore --input DIRECTORY | Stop first; --force preserves existing targets under pre-restore names |
| descriptor-verify --file PATH --expected-signer ADDRESS | Verify a signed descriptor against a trusted identity |

Commands using an instance accept --config PATH, default ./ppops.config.json.
doctor/status print a human-readable report by default; --json is suitable for
automation. Existing commands return JSON. Failure exits nonzero with a stable
code and a safe corrective hint.

## Initialization

The default profile is Arbitrum/native USDC. Supply a viewing-key file, two or
more independent RPC origins and a compatible PPOI endpoint. Three RPC origins
are recommended. --webhook-url enables delivery and creates an HMAC key.

Optional: --port (8787), --scan-interval-ms (30000), --container (internal
0.0.0.0 binding). Other init options and advanced test profiles are listed in
init --help. An explicitly selected non-Arbitrum test network needs explicit
token address, symbol and decimals.

Never put a payer mnemonic or spending key on the merchant host.
init refuses existing files; use the existing config to resume.

## Maintainer evidence

mainnet-gate-replay, mainnet-gate-snapshot, mainnet-gate-verify and
mainnet-gate-report-verify are controlled-pilot commands documented in
[Mainnet gate](MAINNET-GATE.md). They are not prerequisites for trying the demo.
The gate replay deliberately resends a delivered event; routine recovery uses
the authenticated dead-letter endpoint instead.

The separate ppops-payer CLI runs on the payer host. See [payer guide](PAYER-INTEGRATION.md).
