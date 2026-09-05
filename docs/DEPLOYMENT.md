# Deploy and operate PPOps

Run one daemon per receiver, network and token. Preserve its SQLite, encrypted
RAILGUN database, wallet state and secrets across restarts.

This guide describes the unreleased beta.2 source. Published beta.1 images do
not include the new --profile/--container onboarding flow.

## Build this source checkout

Docker runs the merchant daemon without installing Node on the host:

~~~bash
docker compose build ppops
mkdir -p ./instance/data ./instance/secrets
chmod 700 ./instance ./instance/data ./instance/secrets
~~~

Create ./instance/secrets/merchant.viewing-key using an editor or secret manager.
Set that file to 0600. It must contain the shareable viewing key only.

Initialize once, replacing provider placeholders:

~~~bash
PPOPS_UID=$(id -u) PPOPS_GID=$(id -g) docker compose run --rm ppops-init \
  init --container --profile arbitrum-usdc \
  --config /app/config/ppops.config.json \
  --viewing-key-file /app/config/secrets/merchant.viewing-key \
  --rpc-url https://RPC_PROVIDER_A \
  --rpc-url https://RPC_PROVIDER_B \
  --rpc-url https://RPC_PROVIDER_C \
  --poi-node https://YOUR_PPOI_NODE \
  --webhook-url https://YOUR_MERCHANT_BACKEND/webhooks/ppops
~~~

The setup service mounts the instance directory writable to create config and
secrets. The runtime mounts config/secrets read-only and data writable.
Relative paths remain valid inside and outside the container.

~~~bash
PPOPS_UID=$(id -u) PPOPS_GID=$(id -g) docker compose run --rm ppops \
  doctor --config /app/config/ppops.config.json --offline

PPOPS_UID=$(id -u) PPOPS_GID=$(id -g) docker compose run --rm ppops \
  preflight --config /app/config/ppops.config.json

PPOPS_UID=$(id -u) PPOPS_GID=$(id -g) docker compose up -d ppops

curl --fail http://127.0.0.1:8787/v1/ready
~~~

A 503 response during synchronization is expected. Observe status inside the
running container:

~~~bash
docker compose exec ppops node dist/cli.js status --config /app/config/ppops.config.json
~~~

On subsequent starts, reuse the existing instance. init refuses to overwrite it.
Use the host UID/GID consistently so both setup and runtime own their files.

## Use a published image

For an image release containing these commands, obtain its immutable GHCR digest
from the matching release. Set PPOPS_IMAGE to that full image@sha256:digest,
then pull and run the same Compose profile with --no-build. Keep the source
Compose file and image version aligned.

beta.2 has not been published yet. To test this working tree, build it locally.
Do not replace a digest with a guessed tag or assume beta.1 contains new commands.

## Public checkout and private API

Compose binds the host port to 127.0.0.1. A TLS reverse proxy can expose only:

~~~text
/pay/:id
/pay/:id/request.json
/payer-guide
/assets/pay.css
/assets/pay.js
~~~

[The Nginx example](../config/nginx.example.conf) provides that route policy.
Configure your hostname, certificates and edge rate limits. Keep /v1/*,
metrics and authenticated merchant data on the private network.

A local demonstration link cannot be used by a payer on another machine.
Construct checkout URLs with your public payment origin and distribute the
merchant signer through a separate trusted identity channel.

## Resource and lifecycle expectations

The Compose profile runs non-root, with a read-only root filesystem, dropped
capabilities and no-new-privileges. It allows 4 GiB RAM, 2 CPUs, 256 processes,
bounded logs and a temporary filesystem.

These are configured limits, not measured capacity guarantees. Initial scan
duration and disk growth depend on receiver history, SDK and provider behavior.
The healthcheck has a fifteen-minute startup allowance; actual synchronization
may exceed it. status distinguishes a process that is live from one ready to
reconcile payments.

SIGTERM stops new traffic and waits for the current scan. The SDK cannot cancel
it, so Compose allows thirty minutes. Backups and restores must be offline.

## Backup, restore and upgrades

1. Stop the daemon cleanly and wait for its active scan to finish.
2. Run backup into a new directory. By default it includes state and secret
   fingerprints, not secret values.
3. Back up the referenced secrets separately in an authenticated secret system.
4. Test restore into an isolated directory. Chain history cannot reconstruct
   the private reference-to-order mapping if SQLite is lost.
5. Review [release changes](../CHANGELOG.md), preserve rollback state and pin the
   new source/image.
6. Validate, preflight, start and wait for a full successful scan.
7. Check your merchant webhook receiver and a controlled integration before
   resuming ordinary traffic.

The explicit backup --include-secrets option creates a sensitive recovery bundle.
restore --force moves existing state to timestamped pre-restore paths.
Retain those paths until the restored instance is verified.

Use [the production runbook](PRODUCTION-RUNBOOK.md) for alerts and key rotation,
and [troubleshooting](TROUBLESHOOTING.md) for recovery.
