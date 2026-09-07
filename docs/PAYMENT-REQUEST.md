# PPOps Payment Request v1

The existing request envelope is the interoperability boundary for a compatible
payer. This specification documents beta.3; the QR and readiness UX are
additions since beta.2. There is no registered ppops:// scheme and no
claim that an ordinary wallet can scan and execute it.

## Transport

GET /pay/:opaqueIntentId/request.json returns the public JSON request. The checkout
QR encodes its absolute URL, not a bare receiving address. Copy and download expose
the same request. Production uses HTTPS; loopback HTTP is for local development
only and cannot be reached by a wallet on another device.

Do not append order IDs, customer information, credentials or trust pins. The
reference payer refuses redirects and bounds URL downloads. A local request file
can be inspected/prepared, but submission requires the live request to recheck
current state. Treat the URL/file as private: holders can inspect payment terms
and status. No merchant API authorization token belongs in a payer request.

## Signed descriptor

EIP-712 domain: name "PPOps Payment Descriptor", version "1", chainId matching the
descriptor. The PPOpsPaymentDescriptorV1 type has these ordered fields:

| Field | EIP-712 type |
| --- | --- |
| version | uint8 |
| chainId | uint256 |
| rail | string |
| tokenAddress | address |
| decimals | uint8 |
| amountAtomic | uint256 |
| recipient0zk | string |
| reference | bytes32 |
| expiresAt | uint64 |
| nonce | bytes32 |
| merchantSigner | address |

See src/security/descriptor-format.ts in the source checkout and the
[HTTP schema](openapi.json). Amounts are decimal integer strings, never floating
point. Expiry is Unix seconds. Reference is preserved as the transfer's encrypted
memo: ppops:v1: followed by the complete 0x-prefixed reference.

The public envelope repeats payment terms and adds id, amountFormatted,
expectedMerchantSigner, status, receivedAmountAtomic, pendingAmountAtomic and
reconciliationReady. Current source also adds paymentStage and
overpaymentAmountAtomic; the local demo marks simulated: true. These outer
presentation/status fields are **not covered by the descriptor signature**.
amountFormatted is a convenience, not authoritative arithmetic. Consumers must
tolerate additive outer fields while rejecting inconsistent signed terms.

## Required payer checks

1. Obtain the expected merchant public signer through a separate trusted channel.
   The request's expectedMerchantSigner is not independent identity evidence.
2. Recover the signature against the exact domain/type. Match the recovered,
   descriptor and independently pinned signer addresses.
3. Require version 1, rail railgun, Arbitrum One chain 42161, native USDC address
   0xaf88d065e77c8cC2239327C5EDb3A432268e5831 and 6 decimals for this profile.
4. Bind every repeated term to the descriptor. Decode/validate the private receiver
   with the wallet's RAILGUN address implementation. Check positive amount, exact
   reference/memo and unexpired request. Reject simulated requests.
5. Require an OPEN request with no received or pending payment and no explicit
   merchant reconciliation-unavailable flag. Never infer safe retry from a timeout.
6. Check local readiness against amount plus fee budget. Obtain a current quote,
   show amount/fee/total, then require explicit payer authorization.
7. Re-read the live request and compare its identity/descriptor before submission;
   preserve the payment reference and existing submission recovery journal.
8. Observe the merchant's acceptance state. A submitted transaction or signed
   descriptor is not a receipt. Only the merchant reconciler can produce its
   payment.confirmed event after FINALIZED + SPENDABLE + MATCHED.

The checkout verifies signed fields locally but is not a replacement for a payer's
independent verification, recipient decoding or authorization. The reference
implementation is documented in [payer integration](PAYER-INTEGRATION.md).
