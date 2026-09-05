# Run a merchant instance

Use [the local demo](DEMO.md) first if you want to evaluate the API and checkout
without a wallet. This guide configures a real merchant daemon from the current
source checkout. These onboarding commands are not part of v0.1.0-beta.1.

## Before starting

Have these ready:

- Node.js 24, Git and curl. Node 22+ is declared compatible; CI uses Node 24.
- A merchant receiver wallet and its shareable viewing key. Export **Show
  View-Only Private Key** in the wallet, not its seed phrase or spending key.
- Two independently operated Arbitrum RPC origins; three allow a majority to
  keep working when one provider fails.
- A compatible production PPOI endpoint chosen by the operator.
- Persistent storage. The supplied container profile allows 4 GiB RAM and
  two CPU cores; actual scan time and disk use depend on wallet history.

A viewing key cannot spend, but it reveals private financial history. Store
config and secrets in owner-only regular files. Use an editor or secret manager
to create the key file; keep values out of shell arguments and logs.

## 1. Install the merchant

From the supplied source checkout:

~~~bash
npm ci
npm run build
node dist/cli.js --version
node dist/cli.js init --help
~~~

There is no need to install the reference payer on the merchant host.
For containers, follow [Deployment](DEPLOYMENT.md).

## 2. Initialize

Create ./instance/secrets/merchant.viewing-key with your local editor or secret
manager, then set directory permissions to 0700 and the file to 0600.

Replace each provider placeholder:

~~~bash
node dist/cli.js init \
  --config ./instance/ppops.config.json \
  --profile arbitrum-usdc \
  --viewing-key-file ./instance/secrets/merchant.viewing-key \
  --rpc-url https://RPC_PROVIDER_A \
  --rpc-url https://RPC_PROVIDER_B \
  --rpc-url https://RPC_PROVIDER_C \
  --poi-node https://YOUR_PPOI_NODE \
  --webhook-url http://127.0.0.1:8790/shop/webhooks/ppops
~~~

The profile selects chain 42161, native USDC and 6 decimals, with finalized-block
finality. init generates independent API, descriptor-signing, database-encryption
and webhook keys. It refuses to overwrite an existing instance.

Record the printed merchantSigner public address. Give it to payers through a
trusted channel separate from the checkout. It is an identity key, not a
RAILGUN spending address.

## 3. Check setup

~~~bash
node dist/cli.js doctor --config ./instance/ppops.config.json --offline
node dist/cli.js preflight --config ./instance/ppops.config.json
~~~

doctor checks the config and individual secret files without a network request.
preflight checks RPC chain agreement, finalized support and PPOI health.
Neither imports or syncs a wallet; viewing-key decoding also occurs at startup.

## 4. Start the daemon

~~~bash
node dist/cli.js serve --config ./instance/ppops.config.json
~~~

In another terminal:

~~~bash
node dist/cli.js status --config ./instance/ppops.config.json
~~~

The first historical scan may take a long time. HTTP health becomes available
after initial engine setup. Wait for readiness before creating live traffic.
Use [Troubleshooting](TROUBLESHOOTING.md) if progress stops or a dependency fails.

## 5. Run the merchant example

The webhook URL above points to the included local example:

~~~bash
npm run example:merchant -- --config ./instance/ppops.config.json
~~~

Open http://127.0.0.1:8790/shop/. Create an example order; its amount and expiry
are persisted before PPOps is called, so retrying preserves the request body.
The example returns a checkout link and verifies payment events before delivery.

This example is local development tooling. Add your application's login,
authorization, product pricing and order-management policy before deploying it.

## 6. Complete a private payment

The payer follows [Payer integration](PAYER-INTEGRATION.md) on a separate
payer-controlled host. It needs existing spendable private native USDC and
enough for the fee. Wallet creation, shielding and PPOI onboarding happen before
this step and have no fixed fifteen-minute guarantee.

Loopback links work on the same machine only. Remote payers need the public
route policy in [Deployment](DEPLOYMENT.md) and the independently trusted signer.

The checkout refreshes status automatically. Fulfill only from a verified
payment.confirmed event and your merchant policy; a transaction hash alone is
not confirmation. See [payment states](PAYMENT-STATES.md).

## Stop and resume

Stop the example and daemon with Ctrl-C. Allow an active scan to drain.
Keep ./instance and its secrets for the next start. Do not rerun init on it.

Before operating real value, establish [backups, upgrades and monitoring](DEPLOYMENT.md).
