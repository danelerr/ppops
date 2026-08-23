# Arbitrum USDC mainnet gate

PPOps is publishable as beta only after every item below has evidence attached
to a release. This gate deliberately requires a fresh private transfer; the
public Sepolia fixture is not sufficient.

## Required profile

- RAILGUN network: `Arbitrum`
- Chain ID: `42161`
- Token: native USDC, `0xaf88d065e77c8cC2239327C5EDb3A432268e5831`
- Decimals: `6`
- Finality: `finalized`
- At least two RPC URLs with distinct origins
- A production PPOI endpoint supplied through the RAILGUN builders channel

## Evidence procedure

1. Initialize PPOps exclusively from a shareable viewing key and record the
   merchant signer. Preserve redacted `config-validate` and `preflight` output;
   preflight must report a healthy RPC quorum and at least one healthy PPOI node.
2. Create an intent with a unique `Idempotency-Key`. Retry the identical
   request and prove the same `pi_` identifier is returned. Reuse the key with
   a changed amount and prove HTTP `409`.
3. Verify the descriptor using the expected signer obtained outside checkout.
   Confirm chain, native USDC address, decimals, exact atomic amount, recipient,
   expiry and memo.
4. From a separate RAILGUN spending wallet, send a private native-USDC transfer
   to the receiver with the exact `ppops:v1:0x…` memo. Never place payer
   spending material on the PPOps host. The controlled Railway Wallet procedure
   is documented in `PILOT-GUIDE.md`.
5. Record the normalized settlement identifier `(chain, TXID version,
   transaction hash, tree, position)`, amount, token, decrypted memo,
   `FINALIZED` state, raw PPOI bucket and `SPENDABLE` state. Redact the opaque
   reference from public evidence.
6. Prove `/v1/ready` stays non-ready before a successful scan and that both RPC
   providers agree on the receipt, block hash and finalized height.
7. Receive exactly one `payment.confirmed` webhook with a valid HMAC, timestamp,
   event ID and key ID. Retry delivery and prove receiver-side deduplication.
8. Stop the daemon, restart with the same encrypted databases, rescan, and prove
   no second confirmation event is created.
9. Run `npm run privacy:test` with invoice/customer canaries and archive the
   resulting `artifacts/privacy-report.json`.
10. Restore the release backup into an isolated directory and verify the intent,
    settlement, projection and outbox state.

## Acceptance

The gate passes only if the intent reaches `PAID` from a `FINALIZED` and
`SPENDABLE` settlement, exact-once behavior survives restart, the privacy report
passes, and no spending key or mnemonic ever enters the PPOps process. Record
transaction identifiers and timestamps privately; publish only redacted proof
unless the merchant explicitly accepts the correlation loss.
