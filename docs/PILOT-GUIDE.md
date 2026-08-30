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
- **Payer wallet:** an independent full RAILGUN wallet with enough private native
  Arbitrum USDC for Gate A. Its separate public self-signer needs Arbitrum ETH;
  Gate B additionally needs private balance for the Broadcaster fee.
- **External infrastructure:** two independent Arbitrum RPC origins, at least
  one compatible PPOI node, the RAILGUN indexing/artifact dependencies inherited
  by the Wallet SDK, and a RAILGUN Broadcaster/Waku path for payer submission.

The reference payer is the separate `ppops-payer` diagnostic harness built
directly on the official RAILGUN Wallet SDK. Railway Wallet remains optional
compatibility evidence; its slow and ambiguous synchronization no longer blocks
the PPOps mainnet gate.

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
  --rpc-url https://your-third-rpc.example \
  --poi-node https://your-compatible-ppoi.example \
  --webhook-url http://127.0.0.1:8790/webhooks/ppops

node dist/cli.js config-validate --config ./ppops.config.json
node dist/cli.js preflight --config ./ppops.config.json
```

The Wallet SDK currently documents `https://ppoi.fdi.network` as a public
community aggregator. It passed PPOps `ppoi_health` preflight on 2026-08-23,
but that health check proves only API compatibility and point-in-time
reachability. Production availability, list policy and trust remain the
operator's responsibility.

For a self-pilot, start the local evidence receiver in a second terminal. It is
loopback-only, verifies the exact HMAC body and headers, rejects event-ID/body
mismatches, persists event IDs and event types for deduplication, and never
stores event payloads:

```bash
npm run pilot:webhook-receiver -- \
  --key-file ./secrets/webhook-hmac-key \
  --key-id v1 \
  --state-file ./pilot/webhook-events.sqlite \
  --port 8790
```

This receiver is gate tooling, not a production merchant backend. A real
merchant must implement the same verification and durable event-ID dedupe in
its fulfillment system.

Publish the merchant signer printed by `init` through an authenticated channel
that is independent of the checkout server. Start PPOps only after the payer or
pilot operator has pinned that signer:

```bash
node dist/cli.js serve --config ./ppops.config.json
```

## 3. Create the pilot intent

Do not create a short-lived intent until the payer already has enough native
USDC in the `Spendable` private balance bucket for the exact Gate A payment (and,
for Gate B, the Broadcaster fee). A first-time shield enters RAILGUN's
Unshield-Only Standby Period (initially about one hour) before it becomes
spendable. Funding and
shielding are onboarding, not checkout; complete them first. Otherwise the
intent may expire while the payer is still in `ShieldPending`.

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

For a deliberately late-payment test, use a separate intent and label that
evidence explicitly. Do not accidentally turn the primary happy-path pilot
into `PAID_LATE` by starting checkout before payer readiness.

## 4. Pay with the reference SDK harness

Run `ppops-payer` on the independent payer host, never inside the PPOps process.
Initialize it with a creation block at or before the payer's first RAILGUN note,
place its recovery mnemonic in an owner-only local file, derive the expected
Railway-compatible public gas signer without printing its key, and synchronize:

```bash
cd tools/ppops-payer
node dist/cli.js derive-self-signing-key \
  --config ./payer.config.json \
  --expected-address PINNED_PAYER_EVM_ADDRESS \
  --derivation-index 0
node dist/cli.js sync --config ./payer.config.json
```

Stop unless the returned 0zk address is the independently expected payer and
native USDC is in the `Spendable` bucket. Then verify the fresh request:

```bash
node dist/cli.js request-verify \
  --request http://127.0.0.1:8787/pay/INTENT_ID/request.json \
  --expected-signer PINNED_MERCHANT_SIGNER
```

Gate A deliberately self-signs so Railway and Broadcaster behavior are excluded
from the primitive test. It publicly links the supplied EVM signer to the
otherwise encrypted transfer. Submit only with explicit identity, amount and gas
bounds:

```bash
node dist/cli.js prepare-self-signed \
  --config ./payer.config.json \
  --request http://127.0.0.1:8787/pay/INTENT_ID/request.json \
  --expected-signer PINNED_MERCHANT_SIGNER \
  --expected-payer PINNED_PAYER_0ZK_ADDRESS \
  --expected-self-signer PINNED_PAYER_EVM_ADDRESS \
  --max-amount-atomic 100000 \
  --max-gas-cost-wei 1000000000000000

node dist/cli.js pay-self-signed \
  --config ./payer.config.json \
  --request http://127.0.0.1:8787/pay/INTENT_ID/request.json \
  --expected-signer PINNED_MERCHANT_SIGNER \
  --expected-payer PINNED_PAYER_0ZK_ADDRESS \
  --expected-self-signer PINNED_PAYER_EVM_ADDRESS \
  --max-amount-atomic 100000 \
  --max-gas-cost-wei 1000000000000000 \
  --confirm-intent INTENT_ID
```

The example gas bound is `0.001 ETH`; it is a maximum, not a target or fee
estimate. The harness validates the signed descriptor, exact native-USDC amount,
recipient, memo, private balance, RAILGUN proxy target and zero ETH value before
submission. It reloads the live request after proof generation, computes and
journals the transaction hash before broadcast, and waits up to two minutes for
a receipt. `PENDING`, `SUBMITTING` or `SUBMITTED` is not permission to retry;
resolve the recorded hash first.

The preparation command exercises sync, proof generation, population and every
bound but returns `paymentSubmitted: false`; it neither signs nor journals a
transaction. Inspect that result before running the value-bearing command.

Controlled result on 2026-08-30: the direct SDK payer prepared a `0.01 USDC`
Arbitrum transfer in 7.8 seconds, confirmed sufficient spendable native USDC,
generated the proof and bounded the populated transaction at
`56190171212000` wei maximum gas cost. It created no submission-journal record
and broadcast no transaction. This validates the non-broadcast path only; Gate
A remains pending until the explicitly approved value-bearing transaction is
mined and PPOps reconciles it to `PAID`.

A final repeat after cleanup failures were made fatal completed in 10.7 seconds,
reported `54286600000000` wei maximum gas cost and again left
`recorded: false`. The variance is expected from live fee and RPC conditions;
neither value is a future gas quote.

After a successful first sync, the encrypted payer wallet loads without the
mnemonic. Keep the recovery backup offline and remove the mnemonic from the
operational payer host if desired. Do not remove the encrypted database key or
self-signing key needed by this diagnostic path.

After Gate A reaches `PAID`, Gate B replaces the public self-signer with a Waku
Broadcaster. Only Gate B supports the final sender-unlinkability claim. The payer
mnemonic, spending key and wallet database remain off the PPOps host in both
modes.

## 5. Accept the payment

Do not fulfill based only on the payer's transaction screen. PPOps must observe
the settlement and derive all three required dimensions:

```text
chainStatus = FINALIZED
poiStatus   = SPENDABLE
matchStatus = MATCHED
```

Only then may the intent become `PAID` or `PAID_LATE`. Verify the authenticated
intent-status endpoint and exactly one valid `payment.confirmed` webhook. The
pilot receiver exposes metadata-minimal evidence at:

```bash
curl --fail http://127.0.0.1:8790/stats
```

After one successful payment and any number of identical delivery retries, it
must show `payment.confirmed: 1`. `receivedEventCount` may be higher because
PPOps also emits `settlement.observed` and legitimate state-transition events;
each distinct event ID is still stored only once.
`duplicateDeliveriesByType.payment.confirmed` must become at least `1` after the
controlled replay below.

Prove an actual duplicate delivery after the original confirmation has reached
the receiver. This command reconstructs the exact stored event payload, signs a
fresh delivery and fails unless the receiver replies that the event was already
persisted:

```bash
node dist/cli.js mainnet-gate-replay \
  --config ./ppops.config.json \
  --intent-id pi_REPLACE_WITH_INTENT_ID
```

Then capture the pre-restart snapshot. `--expected-signer` must be the address
that the payer pinned outside PPOps, not an address copied from checkout:

```bash
node dist/cli.js mainnet-gate-snapshot \
  --config ./ppops.config.json \
  --phase before \
  --intent-id pi_REPLACE_WITH_INTENT_ID \
  --expected-signer 0xREPLACE_WITH_PINNED_SIGNER \
  --output ./pilot-evidence/before.json
```

The snapshot command reruns RPC/PPOI preflight and fails closed unless the
runtime uses Arbitrum, native USDC, finalized-block finality, at least two RPC
origins, a healthy PPOI node, only finalized/spendable/matched settlements,
fresh quorum agreement on every settlement receipt and block hash, exactly one
confirmation event, a delivered outbox entry and receiver-side deduplication for
the confirmation type. Identifiers are represented by
API-token-keyed fingerprints; invoice IDs, private references and transaction
identifiers are omitted. These operator snapshots still disclose exact amounts
and timestamps, so keep them private.

## 6. Finish the release gate

Stop and restart PPOps with the original state, wait for `/v1/ready`, and capture
the second phase with the same base URL:

```bash
node dist/cli.js mainnet-gate-snapshot \
  --config ./ppops.config.json \
  --phase restart \
  --intent-id pi_REPLACE_WITH_INTENT_ID \
  --expected-signer 0xREPLACE_WITH_PINNED_SIGNER \
  --output ./pilot-evidence/restart.json
```

Create a release backup, restore it under an isolated configuration and start
that restored daemon on another loopback port (for example `8788`). Once it is
ready, capture the restore phase using the restored config and origin:

```bash
node dist/cli.js mainnet-gate-snapshot \
  --config ./restore/ppops.config.json \
  --base-url http://127.0.0.1:8788 \
  --phase restore \
  --intent-id pi_REPLACE_WITH_INTENT_ID \
  --expected-signer 0xREPLACE_WITH_PINNED_SIGNER \
  --output ./pilot-evidence/restore.json
```

Finally verify the three authenticated snapshots with the original instance
secret set and write the release artifact:

```bash
node dist/cli.js mainnet-gate-verify \
  --config ./ppops.config.json \
  --before ./pilot-evidence/before.json \
  --restart ./pilot-evidence/restart.json \
  --restore ./pilot-evidence/restore.json \
  --output ./artifacts/mainnet-gate-report.json
```

The verifier requires three distinct daemon-instance fingerprints, the same
origin before/after restart, a different origin for restore, stable intent,
settlement and single-confirmation fingerprints, and valid keyed attestations.
It signs the final metadata-minimal report with the merchant identity key. A reviewer who
obtained the expected signer independently can verify that signature without
receiving the API token or any wallet secret:

```bash
node dist/cli.js mainnet-gate-report-verify \
  --file ./artifacts/mainnet-gate-report.json \
  --expected-signer 0xREPLACE_WITH_PINNED_SIGNER
```

The signature authenticates the merchant's report; it does not pretend to prove
that the operator actually followed the commands. Retain terminal/service
records alongside the report.

Complete every remaining item in `MAINNET-GATE.md`. Preserve raw transaction
evidence privately; publish only redacted evidence. A successful self-payment
is engineering evidence. An Octant adoption claim additionally needs an
independent merchant installation and real merchant feedback.

## Optional Railway Wallet compatibility

Railway may still be tested manually by sending the exact amount and exact
`ppops:v1` value in its **Private memo** field. That path is not the reference
gate and a stalled Railway scan is not allowed to block SDK-level validation.

### Source evidence

- Current reviewed commit: [`a99f8ece`](https://github.com/Railway-Wallet/Railway-Wallet/commit/a99f8ece640afe10ee2b49db07dd0700b9742a39).
- [Desktop enables the memo field](https://github.com/Railway-Wallet/Railway-Wallet/blob/a99f8ece640afe10ee2b49db07dd0700b9742a39/desktop/src/utils/constants.tsx#L13).
- [Desktop private-send review exposes the memo control](https://github.com/Railway-Wallet/Railway-Wallet/blob/a99f8ece640afe10ee2b49db07dd0700b9742a39/desktop/src/views/screens/drawer/review-transaction/ReviewTransactionView.tsx#L1291).
- [Desktop exposes the shareable viewing key](https://github.com/Railway-Wallet/Railway-Wallet/blob/a99f8ece640afe10ee2b49db07dd0700b9742a39/desktop/src/views/screens/modals/settings/SettingsWalletInfoModal/SettingsWalletInfoModal.tsx#L345).
- [RAILGUN Wallet SDK engine/PPOI initialization](https://docs.railgun.org/developer-guide/wallet/getting-started/5.-start-the-railgun-privacy-engine).
