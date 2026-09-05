# Integrate a merchant backend

PPOps is an internal HTTP service. Your backend creates intents and consumes
authenticated events. Your browser receives a checkout URL, never the API token.

Start with [the runnable example](../examples/README.md) or [the local demo](DEMO.md).
The [OpenAPI document](openapi.json) describes request/response shapes.

## Choose HTTP or the optional helper

Any backend can call the HTTP API; no PPOps library is required. The runnable
example already uses the local helper. To use `ppops/client` in a different
Node.js application, first build an archive from this source checkout:

~~~bash
npm ci
npm pack
~~~

The prepack check builds the code and verifies the documentation. This version
produces `ppops-0.1.0-beta.2.tgz`. In your application's directory, install the
actual archive path:

~~~bash
npm install /absolute/path/to/ppops-0.1.0-beta.2.tgz
~~~

The helper targets Node.js 22+ and ESM. This is the complete merchant package,
not a separately published lightweight SDK: installing it also installs the
daemon's dependency tree. Importing `ppops/client` does not start that daemon
or load the RAILGUN runtime. Use HTTP directly if you do not want those
dependencies in your application. `npm install ppops` from the registry is not
the distribution path for this project.

## Create an intent

Your application owns the order price and expiry. Persist them before the first
HTTP request so a timeout or restart does not change an idempotent retry.

~~~ts
import { PPOpsClient, usdcAtomic } from "ppops/client";

const ppops = new PPOpsClient({
  baseUrl: "http://127.0.0.1:8787",
  apiToken: process.env.PPOPS_API_TOKEN!,
});

const request = {
  externalReference: order.id,
  amountAtomic: usdcAtomic("25.00"),
  expiresAt: order.persistedExpirySeconds,
};
const intent = await ppops.createIntent(request, "order:" + order.id);
~~~

Within the repository's examples directory, the direct source-build import is
`../dist/client.js`. Plain HTTP works from any language; see [API reference](API.md).

Persist intent.id and intent.checkoutPath with the order. Construct the customer
link from your configured public payment origin, not the internal API origin.

## Idempotency and errors

- New key: HTTP 201.
- Same key and same body: HTTP 200, Idempotent-Replayed: true.
- Same key and changed body: HTTP 409, IDEMPOTENCY_CONFLICT.

A timeout has an unknown outcome. Retry the **saved** body and key. Recomputing
expiresAt while reusing the key is a different request. The client does not
automatically retry creates; your application owns that policy.

amountAtomic is a positive integer string. One USDC is 1000000. expiresAt is
a future Unix timestamp in seconds. Validation errors identify accepted field
names without echoing submitted values.

## Webhook verification

~~~ts
import { verifyPaymentWebhook } from "ppops/client";

const event = verifyPaymentWebhook({
  rawBody: new Uint8Array(await request.arrayBuffer()),
  headers: request.headers,
  keys: { v1: process.env.PPOPS_WEBHOOK_KEY_HEX! },
});
~~~

Capture the raw bytes before JSON parsing. The helper checks timestamp freshness,
known key IDs, constant-time HMAC, event schema and matching header/body event IDs.
It supports simultaneous old/new key IDs during rotation.

The signature covers timestamp + "." + keyId + "." + eventId + "." + rawBody,
using the configured hex-decoded HMAC key. The reference freshness window is
five minutes. [API reference](API.md) lists headers and the event envelope.

## Delivery and business state

In one transaction in **your** database:

1. Check whether the event ID was processed. For a valid duplicate, return 2xx.
2. Resolve event.intentId to the stored order and verify the expected amount.
3. Store the event receipt and update the order according to its type and status.
4. Commit before returning 2xx.

Fulfill payment.confirmed with PAID only when the order is eligible for delivery.
Apply your own policy to PAID_LATE. Track order fulfillment idempotently as well
as event IDs: multiple state revisions must not deliver the same product twice.

Acknowledge other valid event types even if they do not trigger delivery.
Route payment.reverted to review/compensation. Do not derive fulfillment from
settlement.observed, a transaction hash or chain finality alone.

Events omit externalReference. Resolve the order using the intent ID you stored.
See [payment states](PAYMENT-STATES.md) for partial payments, expiry and reversions.

## Checkout and identity

Expose only /pay/:id, /pay/:id/request.json, /payer-guide and the checkout assets
on the public payment hostname. Publish the expected merchant signer separately
through an authenticated merchant identity channel. A signer displayed by that
same checkout is not an independent trust root.

The checkout refreshes its status, but does not verify a merchant identity on
the customer's behalf or submit a spend. The separate payer performs those
checks. Consult [payer compatibility](PAYER-INTEGRATION.md).

## Operations

Keep the API private. Use readiness for accepting new traffic, inspect outbox
delivery failures, and back up your order mapping as well as PPOps state.
See [Deployment](DEPLOYMENT.md) and [Troubleshooting](TROUBLESHOOTING.md).
