# PPOps PayIn

PayIn is an incoming private payment operation: signed request, payer execution,
view-only detection, privacy/finality validation, matching and merchant notification.

This guide describes **v0.1.0-beta.3**. Build that source tag to try the PayIn UX.
The beta.2 tag does not contain this checkout revision.

## One operation, four responsibilities

~~~text
Merchant API → signed payment request → separate payer → reconciliation + webhook
~~~

The merchant supplies amount, local order reference and expiry to POST /v1/intents.
The configured instance supplies network, token and receiver. Use checkoutPath on
your public HTTPS payment origin; it is not a hosted PPOps URL. Order references
stay on the merchant side, outside the public request.

The payer verifies the request, checks its private balance, reviews the fee and
authorizes a private transfer. PPOps does not hold its spending key. The daemon
observes and reconciles independently of the checkout browser.

## What the checkout does

Open /pay/:id to see the amount, network, signature result and current payment
state. **Pay privately** opens a locally generated request-link QR and copy/download
handoff. It does not submit funds or connect a wallet. A compatible payer must
consume the request; consumer-wallet QR/deep-link support is not yet validated.

The browser verifies the EIP-712 signature and binds the displayed amount, token,
chain, receiver, reference and expiry to it. “Signature valid” is not an identity
endorsement. Advanced details allows comparison with a public merchant signer
obtained independently. The spending wallet must perform its own verification.

The checkout refreshes every five seconds while visible. Updates pause in hidden
tabs and resume when reopened. Missing, unavailable or inconsistent requests
disable payment instructions. A connection failure marks the last status stale.
Closing the page does not stop merchant scanning or webhook delivery; the daemon
must remain running and healthy. The page itself sends no notifications.

## Payment language, not protocol steps

| Internal condition | Payer-facing meaning |
| --- | --- |
| Matching settlement observed, not yet eligible | Payment detected; do not send again |
| Enough matched value finalized but not spendable | Payment confirmed onchain; privacy validation still pending |
| FINALIZED + SPENDABLE + MATCHED, enough value | Payment complete, or late payment requiring merchant review |
| Partial eligible value | Received amount and remaining amount; ask the merchant before another transfer |
| Expired request without payment | Request a new link; do not pay this request |
| Reverted matched transfer without remaining pending value | Payment needs review; do not automatically retry |
| ShieldPending / pending balance checks | Private balance preparing |
| Spendable | Private balance ready |
| Broadcaster quote | Network fee |
| 0zk address / encrypted memo | Private receiving address / payment reference |

Finality, spendability and matching are independent acceptance conditions, not a
new sequential ledger state machine. Existing statuses OPEN, PARTIAL, PAID,
EXPIRED and PAID_LATE remain unchanged. Only reconciliation credits funds.
paymentStage is a public presentation projection, not acceptance evidence signed
by the descriptor. The existing merchant event is **payment.confirmed**, not
payin.completed or payment_intent.paid.

An overpayment is shown separately; PPOps does not automatically refund it.
PAID_LATE is not normal fulfillment. PARTIAL can persist after expiry. See
[payment states](PAYMENT-STATES.md) for precise policy and reversal semantics.

## Readiness belongs on the payer host

The reference payer's readiness command verifies a request, synchronizes the
wallet locally and compares spendable/private-pending balances with the payment
plus an explicit fee budget. It returns READY, INSUFFICIENT_PRIVATE_BALANCE,
PRIVATE_BALANCE_PENDING, SYNCING, RAIL_UNAVAILABLE, REQUEST_EXPIRED or
REQUEST_NOT_PAYABLE. The last state prevents duplicate or partial-payment retries.

READY is a snapshot for that budget, **not a fee quote or spending approval**.
The later preparation/payment commands still validate fresh state and actual fees.
No reliable preparation ETA is available; estimatedReadyAt is null. The checkout
cannot determine an unrelated wallet's balance. See [payer integration](PAYER-INTEGRATION.md).

## Privacy boundary

- No analytics, trackers, external fonts, session replay or third-party scripts.
- Signature and QR code run in the browser using a same-origin bundled asset.
- Checkout/request responses use no-store and no-referrer; the checkout uses a
  restrictive Content Security Policy without inline scripts.
- No mnemonic, spending/viewing key, API token or database key is requested by the page.
- URLs carry only an opaque intent capability, never order/customer/email metadata.
  Anyone holding that URL can read its amount, recipient and status. It is not a
  public marketing link. Reverse proxies must preserve headers and avoid logging it.
- Request signatures bind intent terms, not merchant identity or settlement proof.
  The payment origin still serves trusted application code and must be protected.

## Delivered now, still to validate

Beta.3 implements the scoped P0 checkout, local verification, auto-refresh,
complete/partial/late/expired/reverted displays, advanced details, private headers,
reference-payer readiness and request QR. The wallet-free demo exercises receipt
and merchant fulfillment, not a real wallet handoff or private liquidity readiness.

The desired three actions and under-60-second submission are **targets**, not
achieved claims. The reference CLI still requires technical preparation. Open-in-wallet,
live fee preview, balance preparation and notifications are future work. Validate
with the [usability protocol](USABILITY-TESTING.md) before making consumer UX claims.

Payout is deliberately outside this scope: [roadmap](ROADMAP.md).
