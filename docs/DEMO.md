# Try the complete flow locally

The demo is an isolated, single-process example. It uses the real intent service,
signed descriptor, reconciliation projection, transactional outbox and raw-body
webhook verifier. It substitutes simulated settlement input and an in-process
HTTP transport for a RAILGUN wallet and network services.

From the current source checkout:

~~~bash
npm ci
npm run demo
~~~

Open http://127.0.0.1:8788/shop/ and follow these steps:

1. Click **Create order**. The merchant stores an order ID, price and expiry,
   then creates an idempotent PPOps intent.
2. Click **Open payment request**. The page is clearly marked as a simulation.
3. Click **Simulate payment**. PPOps receives a fictitious finalized/spendable
   settlement, derives PAID and delivers its signed event to the example merchant.
4. Return to the shop using the browser's Back button. The order becomes fulfilled
   and fulfillment_count is 1. Retrying the order preserves its intent.
5. Stop with Ctrl-C. The temporary databases are deleted.

To use another port:

~~~bash
npm run demo -- --port 8798
~~~

The demo reads no instance config or wallet secrets and binds only to loopback.
Its recipient is deliberately not a valid payment address. Its confirmation
route is created only by the demo, never by serve. Do not use demo output as a
payment receipt or as mainnet evidence.

For real integration, continue with [Merchant integration](MERCHANT-INTEGRATION.md).
