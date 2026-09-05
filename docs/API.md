# HTTP API reference

Base URL: http://127.0.0.1:8787. The authenticated API belongs on the merchant's
private network. The [OpenAPI document](openapi.json) is generated from shared
schemas; retrieve the running version at GET /v1/openapi.json with Bearer auth.

## Create a payment request

POST /v1/intents requires Authorization: Bearer TOKEN, Content-Type:
application/json and Idempotency-Key (8–128 letters, digits, dots, underscores,
colons or hyphens).

| Field | Type | Meaning |
| --- | --- | --- |
| externalReference | string, 1–512 non-blank characters | Local order/invoice reference; not exposed in the public request |
| amountAtomic | positive integer string | Expected amount in token atomic units |
| expiresAt | future integer Unix seconds | Persist once and reuse on retries |

Build the body with a current expiry:

~~~js
const body = {
  externalReference: "ORDER-9281",
  amountAtomic: "25000000",
  expiresAt: Math.floor(Date.now() / 1000) + 7200,
};
~~~

Save body before sending. A successful new request is HTTP 201; an exact
key/body replay is 200; a changed body with the same key is 409.

The response is the intent object directly, with id, externalReference, chainId,
tokenAddress, tokenSymbol, decimals, expectedAmountAtomic, receivedAmountAtomic,
pendingAmountAtomic, overpaymentAmountAtomic, status, expiresAt, createdAt,
revision, checkoutPath and payment. payment contains rail, recipient, memo and
the signed descriptor. See OpenAPI's Intent schema for exact types.

## Routes

| Method | Path | Authentication / purpose |
| --- | --- | --- |
| GET | /v1/live | Public process liveness |
| GET | /v1/ready | Public readiness; 503 until a recent complete scan |
| GET | /v1/health | Public redacted scan state |
| GET | /pay/:id | Public checkout |
| GET | /pay/:id/request.json | Public signed, metadata-minimal payer request |
| GET | /payer-guide | Public payer requirements |
| GET | /assets/pay.css, /assets/pay.js | Public checkout assets |
| POST | /v1/intents | Bearer; create/replay |
| GET | /v1/intents | Bearer; list |
| GET | /v1/intents/:id | Bearer; full intent |
| GET | /v1/intents/:id/status | Bearer; amounts, state, expiry and revision |
| GET | /v1/runtime | Bearer; redacted instance/profile identity |
| GET | /v1/settlements | Bearer; settlement facts |
| GET | /v1/events | Bearer; event history |
| GET | /v1/outbox | Bearer; attempts, delivery/dead-letter time and failure code |
| POST | /v1/outbox/:eventId/replay | Bearer; schedule a dead-lettered event only |
| POST | /v1/descriptors/verify | Bearer; verify against the daemon's merchant signer |
| GET | /v1/metrics | Bearer; Prometheus text |
| GET | /v1/openapi.json | Bearer; machine-readable reference |

Demo and example-shop routes do not exist on the real daemon.

## Pagination

List routes return { items, limit, offset }. Default limit is 100, maximum 250;
offset starts at zero. Continue with offset + items.length until a short page.
There is no total count, status filter, intent filter or snapshot cursor.

Intents sort newest creation first, settlements newest observation first;
events and outbox sort oldest event first. Concurrent inserts can shift offset
pages. Deduplicate by stable ID during exports and do not treat a traversal as
a transactional snapshot.

## Errors

Errors use { error: { code, hint?, field?, issues? } }. Code is stable; clients
must tolerate added diagnostic fields. Request values, provider URLs and secrets
are not echoed.

Common outcomes: 400 invalid body/key/expiry, 401 unauthorized, 404 not found,
409 idempotency conflict or ineligible replay, 413 oversized body, 415 wrong
content type, 429 rate limited (Retry-After header), 500 internal failure.

After a failed or timed-out create, preserve the original key and body.
The body limit is 64 KiB. Limit requests and avoid logging authenticated payloads.

## Events and signatures

Every event includes schemaVersion: 1, eventId, type, occurredAt, intentId,
intentStatus, receivedAmountAtomic, expectedAmountAtomic and
overpaymentAmountAtomic. settlementId is optional.

Headers: PPOps-Event-Id, PPOps-Timestamp, PPOps-Key-Id, PPOps-Signature.

Signature value: v1= followed by lowercase HMAC-SHA256 hex. The signed bytes
are timestamp.keyId.eventId.rawBody. Decode the configured HMAC key from hex.
Verify freshness, known key ID, exact bytes, event schema and matching header/body
identity; then deduplicate durably. Delivery is at least once.

See [merchant integration](MERCHANT-INTEGRATION.md) for executable verification
and [payment states](PAYMENT-STATES.md) for event semantics.

## Versioning

HTTP paths and event schemas remain v1. New response fields may be added;
consumers should tolerate them. Required-input or semantic changes need release
notes and an explicit compatibility decision. Public beta.1 evidence does not
automatically cover later code changes.
