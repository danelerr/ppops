# Pay a PPOps request

The payer is a separate wallet/runtime on a payer-controlled host. PPOps on the
merchant host only observes incoming private notes.

## Compatibility

| Payer | Status |
| --- | --- |
| tools/ppops-payer | Reference CLI; controlled Gate A/B evidence for its recorded commit |
| Railway Wallet | Optional manual compatibility path; exact memo, wallet sync and version must be checked before use |
| Ordinary public EVM transfer | Does not satisfy a private PPOps request |
| General consumer checkout/deep links | Not independently validated in this beta |

The reference payer is for technical integrations. Do not infer that a wallet
is compatible merely because it supports USDC or connects to Arbitrum.

## Before creating a live request

Have private **native USDC on Arbitrum** available in the RAILGUN Spendable
bucket, plus the fee. Public funding, shielding and any PPOI standby period
occur before this step. PPOps does not create/fund a payer wallet.

Obtain the expected merchant signer through a trusted channel separate from
the checkout. The request's embedded signer cannot authenticate itself.

## Set up on the payer host

Use the same source release supplied for the pilot:

~~~bash
cd tools/ppops-payer
npm ci
npm run build
node dist/cli.js --version
node dist/cli.js init --help
~~~

Use the payer's own provider endpoints. Choose a creation block at or before
its first relevant RAILGUN activity:

~~~bash
node dist/cli.js init \
  --config ./payer.config.json \
  --creation-block FIRST_PAYER_RAILGUN_BLOCK \
  --rpc-url https://PAYER_RPC_A \
  --rpc-url https://PAYER_RPC_B \
  --rpc-url https://PAYER_RPC_C \
  --poi-node https://PAYER_PPOI_NODE
~~~

Create the configured mnemonic file using a local editor, set it to 0600 and
run secrets-check then sync. Only the payer host handles that spending material.

The advanced --from-ppops-config option imports provider settings from an
existing locally accessible config. A relative merchant config path is not a
cross-machine handoff. Do not copy merchant secrets or credential-bearing
configuration to solve a missing file on another host.

## Verify the request

Download request.json from the checkout, or use its HTTPS URL:

~~~bash
node dist/cli.js request-verify \
  --request https://PAY_HOST/pay/INTENT_ID/request.json \
  --expected-signer PINNED_MERCHANT_SIGNER
~~~

This command does not open a full wallet. Verification must cover signature,
chain 42161, native-USDC token, amount, recipient, memo and expiry.

## Prepare, review, authorize

Follow the [Broadcaster runbook](../tools/ppops-payer/docs/GATE-B.md) to pin trusted
fee signers, check connectivity and prepare a transfer. Preparation does not
send funds. Review the exact amount and independent maximum fee in atomic units
(1 USDC = 1000000). The pay command repeats validation against fresh state and
requires the exact confirmed intent ID.

Keep the transfer memo unchanged. Submit from the payer wallet only after
authorizing the amount, fee and intent. The merchant checkout refreshes the
receipt state automatically but does not submit a payment.

## If confirmation takes time

A detected transaction is not enough: the receiver needs finality, a valid
match and PPOI spendability. Output PPOI may need to complete on the payer.
Use [payment states](PAYMENT-STATES.md) to interpret the merchant state.

For an ambiguous submission use submission-status and recover-broadcaster.
Preserve the journal and resolve the existing lineage before another payment.
Do not infer a safe retry from an HTTP timeout or a wallet balance label.

The [self-signed Gate A](../tools/ppops-payer/docs/GATE-A.md) is an explicit
diagnostic: the public EVM signer is associated with its transaction.
The Broadcaster path does not load that optional self-signing key.

See [the payer reference](../tools/ppops-payer/README.md) for complete command
details and recovery. Its dated pilot evidence is not a new external test of
this checkout revision.
