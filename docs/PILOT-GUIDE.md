# Controlled Arbitrum USDC pilot

This guide runs one real PPOps payment without ever placing a mnemonic or
RAILGUN spending key on the PPOps host. Complete it before inviting an external
merchant.

## Components and trust

- **Merchant receiver wallet:** a full RAILGUN wallet kept on a separate trusted
  device. It owns the receiver and exports only its shareable viewing key to
  PPOps.
- **PPOps host:** stores the viewing key, encrypted RAILGUN database key,
  merchant identity key, API token and local reconciliation database. It cannot
  spend receiver funds.
- **Payer wallet:** an independent full RAILGUN wallet with private native
  Arbitrum USDC and enough balance for the Broadcaster fee.
- **External infrastructure:** two independent Arbitrum RPC origins, at least
  one compatible PPOI node, the RAILGUN indexing/artifact dependencies inherited
  by the Wallet SDK, and a RAILGUN Broadcaster/Waku path for payer submission.

Railway Wallet is a practical current client for the controlled pilot. Its
official source enables the private memo field on desktop and mobile and passes
`memoText` into private-transfer proof generation. Treat that as client
compatibility evidence, not an endorsement or availability guarantee.

## 1. Prepare the merchant receiver

1. Create or select a dedicated merchant wallet in Railway Wallet on a trusted
   device. Do not create the spending wallet on the PPOps server.
2. In wallet settings, open **Show Shareable Viewing Key**. Copy only that key
   into a new server-side file and set mode `0600`:

   ```bash
   chmod 600 /secure/path/merchant.viewing-key
   ```

3. Record the receiver's `0zk` address. The shareable viewing key reveals the
   complete receiver history across supported chains and cannot be revoked for
   that wallet. Transport and store it as confidential financial data.

## 2. Initialize PPOps

Use native Arbitrum USDC, not bridged `USDC.e`:

```bash
npm ci
npm run build

node dist/cli.js init \
  --config ./ppops.config.json \
  --viewing-key-file /secure/path/merchant.viewing-key \
  --network Arbitrum \
  --token-address 0xaf88d065e77c8cC2239327C5EDb3A432268e5831 \
  --token-symbol USDC \
  --token-decimals 6 \
  --rpc-url https://your-first-rpc.example \
  --rpc-url https://your-independent-rpc.example \
  --poi-node https://your-compatible-ppoi.example

node dist/cli.js config-validate --config ./ppops.config.json
node dist/cli.js preflight --config ./ppops.config.json
```

The Wallet SDK currently documents `https://ppoi.fdi.network` as a public
community aggregator. It passed PPOps `ppoi_health` preflight on 2026-08-23,
but production availability and trust remain the operator's responsibility.

Publish the merchant signer printed by `init` through an authenticated channel
that is independent of the checkout server. Start PPOps only after the payer or
pilot operator has pinned that signer:

```bash
node dist/cli.js serve --config ./ppops.config.json
```

## 3. Create the pilot intent

Read the generated API token from its file into the merchant backend's secret
store. Do not paste it into tickets or public evidence. Create an intent with a
new idempotency key:

```http
POST /v1/intents
Authorization: Bearer <API token>
Idempotency-Key: pilot-order-0001
Content-Type: application/json

{
  "externalReference": "PILOT-ORDER-0001",
  "amountAtomic": "100000",
  "expiresAt": <current Unix time + 3600>
}
```

Replace the angle-bracket expression with an integer immediately before sending
the request; it deliberately makes the displayed body illustrative rather than
copy-paste JSON. `100000` atomic units is `0.10 USDC`. Retry the identical
request and verify that PPOps returns the same intent. Keep the returned
checkout path, recipient, memo and descriptor together.

## 4. Pay from Railway Wallet

1. On the independent payer device, select Arbitrum and ensure the private
   balance contains native USDC. A newly shielded balance may remain unavailable
   during the PPOI standby period; wait until the wallet marks it spendable.
2. Open the PPOps checkout and independently compare its merchant signer with
   the pinned signer. Verify chain ID `42161`, token address, amount, recipient
   and expiry.
3. In Railway Wallet, start a **private send** to the exact `0zk` recipient for
   the exact native-USDC amount.
4. In the transaction review, paste the complete
   `ppops:v1:0x<64 lowercase hex characters>` value into
   **Private memo (optional)** and press **UPDATE**. Do not proceed until the
   control reads **SAVED**.
5. Recheck recipient, amount and memo, then submit through a Broadcaster. The
   payer mnemonic, spending key and wallet database must remain off the PPOps
   host.

## 5. Accept the payment

Do not fulfill based only on the payer's transaction screen. PPOps must observe
the settlement and derive all three required dimensions:

```text
chainStatus = FINALIZED
poiStatus   = SPENDABLE
matchStatus = MATCHED
```

Only then may the intent become `PAID` or `PAID_LATE`. Verify the authenticated
intent-status endpoint and exactly one valid `payment.confirmed` webhook.

## 6. Finish the release gate

Complete every item in `MAINNET-GATE.md`, including restart without duplicate
events and an isolated backup restore. Preserve transaction identifiers and raw
evidence privately; publish redacted evidence only. A successful self-payment
is engineering evidence. An Octant adoption claim additionally needs an
independent merchant installation and real merchant feedback.

## Source evidence for Railway Wallet compatibility

- Current reviewed commit: [`a99f8ece`](https://github.com/Railway-Wallet/Railway-Wallet/commit/a99f8ece640afe10ee2b49db07dd0700b9742a39).
- [Desktop enables the memo field](https://github.com/Railway-Wallet/Railway-Wallet/blob/a99f8ece640afe10ee2b49db07dd0700b9742a39/desktop/src/utils/constants.tsx#L13).
- [Desktop private-send review exposes the memo control](https://github.com/Railway-Wallet/Railway-Wallet/blob/a99f8ece640afe10ee2b49db07dd0700b9742a39/desktop/src/views/screens/drawer/review-transaction/ReviewTransactionView.tsx#L1291).
- [Desktop exposes the shareable viewing key](https://github.com/Railway-Wallet/Railway-Wallet/blob/a99f8ece640afe10ee2b49db07dd0700b9742a39/desktop/src/views/screens/modals/settings/SettingsWalletInfoModal/SettingsWalletInfoModal.tsx#L345).
- [RAILGUN Wallet SDK engine/PPOI initialization](https://docs.railgun.org/developer-guide/wallet/getting-started/5.-start-the-railgun-privacy-engine).
