# Product model

PPOps is a self-hosted merchant service for private native USDC on Arbitrum.
It creates signed payment requests, observes a receiver through view-only
access and emits payment events after reconciling private settlements.

## Responsibilities

| Component | Owns |
| --- | --- |
| Merchant application | Products, prices, orders, fulfillment and customer policy |
| PPOps daemon | Intent identity, signed requests, viewing/scanning, payment projection and event outbox |
| Separate payer wallet | Private liquidity, descriptor verification, proof generation, fees, submission and recovery |
| External infrastructure | RAILGUN, Arbitrum finality, operator-selected RPC and PPOI availability |

One daemon instance serves one receiver, network and token. The merchant's
spending wallet can remain on a separate device; its viewing capability alone is
imported into PPOps. Invoice/customer identifiers remain in the merchant's local
data, outside the public request and encrypted opaque payment reference.

The service uses a familiar payment-intent lifecycle. A backend creates a
request and waits for an authenticated event before delivering an order.
Self-hosting leaves operation and data with the merchant; it also leaves the
merchant responsible for backups and dependency availability.

## Implemented in the current source

- View-only merchant daemon with authenticated REST API.
- Signed EIP-712 payment descriptor and public request.
- Finality, PPOI and reference-aware reconciliation.
- Transactional outbox with authenticated, retried webhook delivery.
- Checkout with periodic status updates, expiry and payer guidance.
- Isolated demo and runnable merchant integration example.
- Optional TypeScript HTTP and webhook helpers.
- Configuration diagnostics, runtime status and offline backup/restore.
- Separate reference payer with controlled historical Gate A/B evidence.

The demo, diagnostics, HTTP helpers and refreshed checkout are additions in
unreleased beta.2. The published beta.1 tag has the earlier product surface.

## Not included

PPOps does not provide spending custody, wallet funding, refunds, swaps, fiat
conversion, commerce plugins or additional rails. General consumer-wallet
descriptor support and QR/deep-link integrations remain unvalidated.

The reference payer shares the repository for reproducibility, but has its own
dependencies, database, process and secrets. Merchant code must never import
that spending runtime. Documentation packaged with the merchant may describe
the payer; that does not include its executable code.

## Evidence and adoption

Historical controlled Arbitrum pilots support the narrow behavior recorded at
their commits. They do not establish independent adoption, general wallet
usability or production readiness for a later revision.

Use [Merchant integration](MERCHANT-INTEGRATION.md) for application code,
[Payment states](PAYMENT-STATES.md) for exact semantics, and
[the documentation index](README.md) for architecture and dated evidence.
