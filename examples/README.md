# Merchant integration example

For a wallet-free demonstration, run `npm run demo`. For real integration with a
local PPOps instance:

1. Follow [the merchant quickstart](../docs/QUICKSTART.md). Configure its webhook
   URL as `http://127.0.0.1:8790/shop/webhooks/ppops`.
2. Build the source with `npm run build` and start the daemon.
3. Run `npm run example:merchant -- --config ./instance/ppops.config.json`.
4. Open `http://127.0.0.1:8790/shop/`, create an order and open its checkout.
5. Complete the payment with a separate compatible payer. Return to the shop
   using the browser Back button to observe fulfillment.

The price is server-owned and fixed at 1 USDC. The merchant persists the order's
amount and expiry before creating its PPOps intent. HTTP retries reuse that
exact body and idempotency key. The webhook handler verifies original bytes,
timestamp, known key ID, signature, schema and header/body event identity.
It commits event deduplication and order fulfillment in one SQLite transaction.

On-time payments fulfill once. Late payments and reversions go to review.
Unpaid expired orders display an expired state. Other valid events are
acknowledged without fulfillment. An unknown order is
retryable, so a webhook arriving before the intent/order mapping is stored is
not discarded. State persists at `./data/example-merchant.sqlite` by default.

This local example has no account/login system. Before production, add your
application's authentication, order authorization, real catalog, stock handling,
rate limits, retention and policy for partial, excess and reverted payments.
Do not expose the example shop publicly as a complete commerce application.

The executable imports the built HTTP client and merchant handlers; it never
starts the RAILGUN engine. See [merchant integration](../docs/MERCHANT-INTEGRATION.md).
