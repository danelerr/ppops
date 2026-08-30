# PPOps product model

Status: v0.1 product boundary and future direction

## One-sentence description

PPOps is a self-hosted merchant backend that creates signed private-USDC
payment intents, reconciles RAILGUN settlements through view-only access and
notifies the merchant only after finality, PPOI and reference matching agree.

## The useful analogy

PPOps uses a BTCPay Server-style deployment model and a payment-intent lifecycle
familiar from hosted processors:

- like BTCPay Server, the merchant runs the payment infrastructure and keeps
  control of its funds and operational data;
- like a payment-intent API, the merchant creates a bounded payment request,
  waits for a state transition and fulfills from an authenticated webhook;
- unlike a hosted processor, PPOps neither receives the funds nor holds the
  credential required to spend them.

This analogy explains the category. It is not a claim of feature parity with
BTCPay Server or Stripe.

## What the merchant installs

The product is the long-running `ppops` process:

```text
PPOps daemon
├── authenticated REST API
├── signed payment-intent service
├── local SQLite reconciliation state
├── RAILGUN view-only scanner
├── finality and PPOI eligibility checks
└── transactional HMAC webhook outbox
```

The merchant application stays responsible for its product, orders and
fulfillment. PPOps stores the private mapping between the merchant's commercial
reference and an opaque payment reference, but it never publishes the
commercial reference in the payer request or RAILGUN memo.

## Merchant integration

The merchant backend creates an intent through the existing HTTP API:

```http
POST /v1/intents
Authorization: Bearer <local API token>
Idempotency-Key: order-9281
Content-Type: application/json

{
  "externalReference": "ORDER-9281",
  "amountAtomic": "25000000",
  "expiresAt": 1788000000
}
```

For six-decimal native USDC, `25000000` is `25 USDC`. PPOps returns an
unguessable checkout path plus a signed descriptor containing the exact chain,
token, amount, receiver, expiry and opaque memo reference.
The timestamp above is illustrative; every real request must use a fresh future
Unix timestamp appropriate for the payer's readiness.

After the payer submits the private transfer, PPOps derives payment state from
three independent dimensions:

```text
chainStatus = FINALIZED
poiStatus   = SPENDABLE
matchStatus = MATCHED
```

Only the eligible combination can produce intent state `PAID` or `PAID_LATE`
and the existing webhook event:

```json
{
  "schemaVersion": 1,
  "eventId": "evt_...",
  "type": "payment.confirmed",
  "occurredAt": 1788000123,
  "intentId": "pi_...",
  "settlementId": "redacted",
  "intentStatus": "PAID",
  "receivedAmountAtomic": "25000000",
  "expectedAmountAtomic": "25000000",
  "overpaymentAmountAtomic": "0"
}
```

An SDK is optional convenience. A future TypeScript client could wrap
`POST /v1/intents` and the status routes, but it would not add trust or payment
authority and is not needed for v0.1.

## Payer boundary

`tools/ppops-payer` is not the merchant product and is never included in the
merchant build or Docker image. It is a separately executed reference client
with spending authority, used to prove that a wallet can:

1. verify the independently pinned merchant signer;
2. enforce the signed chain, token, amount, receiver, expiry and memo;
3. create the private RAILGUN transfer;
4. let PPOps reconcile it without learning the payer's spending credential.

In a mature ecosystem, a compatible wallet would consume the same payer request
and the reference payer would remain development and conformance tooling.

## Current product versus future integrations

| Capability | v0.1 status |
| --- | --- |
| Self-hosted merchant daemon | Implemented |
| Payment-intent REST API | Implemented |
| Signed EIP-712 payer descriptor | Implemented |
| View-only RAILGUN reconciliation | Implemented |
| Finality, PPOI and matching semantics | Implemented |
| HMAC webhook outbox | Implemented |
| Reference payer | Implemented; Gate A passed 2026-08-30 |
| Mainnet end-to-end evidence | Self-pilot passed; external pilot pending |
| Merchant TypeScript SDK | Not implemented; optional |
| QR/consumer checkout UI | Not implemented |
| WooCommerce/plugin integrations | Not implemented |
| Wallet-native descriptor support | Not implemented |
| Multi-network or multi-rail support | Out of v0.1 scope |

## Claim boundary

Until an external pilot passes, the defensible claim is:

> PPOps implements and has completed a controlled Arbitrum mainnet self-pilot
> for a self-hosted, view-only reconciliation backend for private RAILGUN
> payment intents.

The project must not yet claim production readiness, general wallet usability,
feature parity with established payment servers or verified external adoption.

Self-hosted also does not mean dependency-free. PPOps still depends on the
RAILGUN protocol and Wallet SDK plus operator-selected RPC and PPOI services;
their availability and metadata exposure remain part of the operational model.
