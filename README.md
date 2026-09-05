# PPOps

Self-hosted payment reconciliation for private USDC on Arbitrum.

Your backend creates a payment request. A separate RAILGUN wallet pays it.
PPOps observes the merchant wallet through a viewing key and sends your backend
a signed webhook when the payment is finalized, spendable and matched.

PPOps never holds the merchant's spending keys. Run one instance per receiver,
network and token.

## Try it locally

From this source checkout, with Node.js 24:

~~~bash
npm ci
npm run demo
~~~

Open **http://127.0.0.1:8788/shop/**. Create an order, open its payment request,
click **Simulate payment**, then return to the shop to inspect fulfillment.
No wallet, provider accounts or funds are required. Temporary demo data is
removed when you stop the process.

This is a simulation of the integration, not evidence of a blockchain payment.
See [the demo guide](docs/DEMO.md) for what it exercises.

## Choose your next step

| I want to… | Start here |
| --- | --- |
| Understand the flow in Spanish | [Leer en español](README.es.md) |
| Run a merchant instance | [Merchant quickstart](docs/QUICKSTART.md) |
| Add payments to my backend | [Integration guide](docs/MERCHANT-INTEGRATION.md) |
| Pay from a separate wallet | [Payer guide](docs/PAYER-INTEGRATION.md) |
| Use Docker and operate the service | [Deployment](docs/DEPLOYMENT.md) |
| Resolve a setup or payment issue | [Troubleshooting](docs/TROUBLESHOOTING.md) |
| Look up requests, responses or events | [API reference](docs/API.md) |
| Review architecture and evidence | [Documentation index](docs/README.md) |
| Contribute code or documentation | [Contributing](CONTRIBUTING.md) |

## What a real integration requires

The merchant needs a shareable RAILGUN viewing key, independently operated
Arbitrum RPC endpoints (at least two; three recommended), a compatible PPOI
endpoint and persistent storage. Your backend keeps the API token and verifies
incoming webhooks.

The payer needs private native USDC already available to spend, a compatible
wallet integration and enough balance for the payment and fee. Public EVM
transfers do not pay a PPOps request. The included reference payer is a technical
integration tool; general consumer-wallet compatibility has not been validated.

The supported merchant profile is **Arbitrum One, native USDC, 6 decimals**.
PPOps includes no swaps, refunds, fiat conversion, hosted payment processing or
automatic wallet funding.

## The integration in three steps

1. Your backend sends POST /v1/intents with a stable idempotency key, integer
   amount and future expiry. Persist the returned intent ID with your order.
2. Show the payer the returned checkoutPath on your public payment origin.
   Keep the merchant API token on your backend.
3. Verify the raw-body webhook signature and deduplicate the event ID in the
   same database transaction as fulfillment. Apply your policy for late payments.

[The runnable merchant example](examples/README.md) demonstrates that flow,
including retries and durable deduplication. Optional TypeScript HTTP helpers
are exported at ppops/client from the built source package.

## Release status

The latest recorded published release is **v0.1.0-beta.1**. The onboarding
improvements in this working tree are **unreleased**: demo, doctor, status,
per-command help, the client helpers and these guides are not in that tag.
Use the complete supplied source checkout to try them. Do not switch to beta.1
and expect these commands to exist.

Controlled Gate A/B pilots are recorded in [the evidence index](docs/README.md).
They do not establish external adoption, broad wallet compatibility or production
readiness. Source, tests and local simulations do not replace an independent pilot.

The project is distributed as source and a merchant Docker image; it is not
published on npm. See [deployment](docs/DEPLOYMENT.md) for the difference between
building this checkout and using a published image.

## Development

~~~bash
npm run typecheck
npm test
npm run build
npm run verify
~~~

The payer is an independent package. Only payer contributors and full-release
verification need npm run payer:install followed by npm run verify:all.

## Repository

~~~text
src/                 daemon, HTTP client helpers, isolated demo and merchant example
examples/            runnable merchant integration
config/              deployment examples
docs/                task guides, reference and review evidence
test/                automated checks
tools/ppops-payer/    separate payer package and spending runtime
scripts/             maintainer verification tools
skills/ppops/        agent workflow referring to the same product documentation
artifacts/           signed/redacted historical evidence
~~~

Read [security guidance](docs/SECURITY.md) before operating real value.
Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

Apache-2.0. See [LICENSE](LICENSE).
