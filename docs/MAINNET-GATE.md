# Arbitrum USDC mainnet gate

Controlled self-pilot status: **PASS** on 2026-08-30. The signed public report
is `artifacts/mainnet-gate-report.json`; external adoption remains a separate
gate. This report used diagnostic Gate A self-signing. Gate B's Waku
connectivity and no-send proof preparation pass, but its separate value-bearing
sender-submission evidence is still pending.

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
- At least one compatible production PPOI endpoint selected and evaluated by
  the operator; community and self-hosted nodes are both acceptable

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
   spending material on the PPOps host. The reference path is the independently
   executed `tools/ppops-payer` SDK harness documented in `PILOT-GUIDE.md`;
   Railway Wallet is optional compatibility evidence only.
   Gate A must revalidate the live request immediately before signing and
   persist the locally computed transaction hash before broadcast. Gate B must
   bound the token fee and persist payer identity, the exact
   encrypted-submission quote fingerprint and nullifiers before Waku
   submission. A Waku-returned hash is only a report; Gate B must derive the
   canonical public hash from those nullifiers before it accepts receipt state.
   After the receipt is mined, the payer must generate
   the output PPOI and obtain node acknowledgement; receiver-side
   `MissingExternalPOI` is observation, not payment eligibility.
5. Record the normalized settlement identifier `(chain, TXID version,
   transaction hash, tree, position)`, amount, token, decrypted memo,
   `FINALIZED` state, raw PPOI bucket and `SPENDABLE` state. Redact the opaque
   reference from public evidence.
6. Prove `/v1/ready` stays non-ready before a successful scan and that both RPC
   providers agree on the receipt, block hash and finalized height.
7. Receive exactly one `payment.confirmed` webhook with a valid HMAC, timestamp,
   event ID and key ID. Retry delivery and prove receiver-side deduplication.
   A self-pilot may use the loopback evidence receiver in `PILOT-GUIDE.md`; an
   external merchant must prove deduplication in its own fulfillment backend.
8. Stop the daemon, restart with the same encrypted databases, rescan, and prove
   no second confirmation event is created.
9. Run `npm run privacy:test` with invoice/customer canaries and archive the
   resulting `artifacts/privacy-report.json`.
10. Restore the release backup into an isolated directory and verify the intent,
    settlement, projection and outbox state.

## Automated private evidence and public report

For the controlled self-pilot, use the commands documented in
`PILOT-GUIDE.md`:

```text
mainnet-gate-replay
mainnet-gate-snapshot --phase before
mainnet-gate-snapshot --phase restart
mainnet-gate-snapshot --phase restore
mainnet-gate-verify
```

The snapshot collector reruns live RPC/PPOI preflight and validates the strict
profile, descriptor against the independently pinned signer, payment projection,
settlement eligibility, fresh quorum agreement on each receipt and block hash,
the current finalized height, a single confirmation event/outbox record and
durable receiver deduplication specifically for that confirmation type. The
final verifier authenticates snapshots with the instance API
secret, requires distinct daemon instances, requires a stable origin across
restart and a different origin for restore, and compares redacted state
fingerprints. It writes `artifacts/mainnet-gate-report.json` only after all
three phases agree, then signs that report with the merchant identity key. The
signature is publicly checkable with `mainnet-gate-report-verify` and the signer
distributed outside PPOps; neither the API token nor wallet material is needed.

The three snapshots contain exact amounts and timestamps despite omitting direct
identifiers; keep them private with the API token. Only the final metadata-minimal,
merchant-signed report is intended for publication.

This automates state validation, not the private transfer itself and not the
operator's procedural claim. Archive service/terminal records proving the
restart and isolated restore alongside the redacted report. An external merchant
may replace the pilot receiver evidence with equivalent durable backend records.

## Acceptance

The gate passes only if the intent reaches `PAID` from a `FINALIZED` and
`SPENDABLE` settlement, exact-once behavior survives restart, the privacy report
passes, and no spending key or mnemonic ever enters the PPOps process. Record
transaction identifiers and timestamps privately; publish only redacted proof
unless the merchant explicitly accepts the correlation loss.
