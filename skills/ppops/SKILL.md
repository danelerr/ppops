---
name: ppops
description: Install, configure, verify, integrate, troubleshoot, deploy, or independently pilot the PPOps self-hosted RAILGUN payment reconciler. Use when working with the PPOps daemon, its HTTP API or webhooks, merchant view-only setup, Arbitrum USDC payment intents, the reference payer, operational checks, or PPOps external-pilot evidence.
---

# PPOps

Operate and integrate PPOps through its existing CLI and HTTP API. Treat the
merchant daemon as a view-only reconciliation service and the reference payer
as a separate spending trust domain.

## Enforce the trust boundary

- Never request, load, copy, transform, or store a merchant mnemonic or
  RAILGUN spending key. PPOps accepts only the merchant shareable viewing key.
- Ask for secret **file paths**, never secret values. Never print viewing keys,
  API tokens, signing keys, database-encryption keys, webhook keys, payer
  mnemonics, or EVM private keys.
- Keep secrets and configuration in owner-only regular files (`0600`). Never
  commit them or place them in URLs, CLI arguments, screenshots, logs, or
  evidence artifacts.
- Keep payer spending material off the PPOps merchant host. Use
  `tools/ppops-payer` only on the payer-controlled host.
- Never treat `OBSERVED` or `FINALIZED` alone as payment. Fulfill only from the
  authenticated `payment.confirmed` event or an authenticated intent whose
  derived state is `PAID`/`PAID_LATE`; PPOps requires finality, `SPENDABLE`
  PPOI, and a valid match.
- Do not submit a payer transaction or spend funds without explicit user
  approval of the network, asset, amount, fee ceiling, submission mode, and
  intended payment intent. Run prepare/no-send checks first.
- Keep the v0.1 production profile on Arbitrum One (`42161`) and native USDC
  (`0xaf88d065e77c8cC2239327C5EDb3A432268e5831`, 6 decimals). Do not silently
  substitute another network, token, finality policy, RPC, or PPOI service.

Read [references/SECURITY.md](references/SECURITY.md) before any setup,
integration, deployment, payer, or incident task.

## Select the workflow

### Set up a merchant instance

1. Read [references/QUICKSTART.md](references/QUICKSTART.md).
2. Inspect `package.json`, `node dist/cli.js help`, and the selected release
   before proposing commands. Prefer an immutable release tag/container digest.
3. Accept only an existing merchant viewing-key file. Do not help export or
   recover spending material as part of the daemon setup.
4. Run the repository `scripts/verify-install.sh` against the source checkout.
   Its default verifies only the merchant; `--with-payer` is for release reviewers.
5. Initialize PPOps with at least two independent RPC origins; recommend three
   for 2-of-3 availability. Do not select a paid provider or PPOI operator
   without the user's direction.
6. Run `config-validate`, `preflight`, then start the daemon.
7. Run `ppops doctor --offline`, `ppops preflight`, then `ppops status` after starting.
   These commands never create an intent or submit a payment.
8. Create a low-value intent only after the daemon is ready. State clearly that
   the payer must already have enough private native USDC in the `Spendable`
   bucket; first-time shield/PPOI onboarding and historical scan time have no fixed setup guarantee.

### Integrate a merchant application

1. Read [references/API.md](references/API.md).
2. Inspect the application. Use raw HTTP or the source package's `ppops/client`
   helpers; the package is not published on npm. Read the canonical API/OpenAPI
   and use the runnable merchant example for webhook handling.
3. Create intents server-side with a stable `Idempotency-Key`; persist the
   merchant order to PPOps intent-ID mapping.
4. Expose only the unguessable checkout URL/request to the payer. Keep the API
   token and `externalReference` server-side.
5. Verify webhook HMAC against the **raw** body, enforce timestamp freshness,
   and atomically deduplicate `PPOps-Event-Id` before fulfillment.
6. Test duplicate delivery and non-2xx retry behavior.

### Work on a payer integration

Read [references/PAYER.md](references/PAYER.md). Verify the descriptor against
an expected merchant signer obtained independently of the checkout. The
reference payer is testing/integration tooling, not a consumer wallet. Prepare
first; submit only with explicit financial authorization.

### Troubleshoot an installation

Read [references/TROUBLESHOOTING.md](references/TROUBLESHOOTING.md). Preserve
fail-closed behavior. Do not fix quorum, PPOI, scan, or webhook failures by
weakening payment criteria or manually marking an intent paid.

### Run an independent pilot

Read [references/EXTERNAL-PILOT.md](references/EXTERNAL-PILOT.md). Prefer an
independently controlled merchant installation over payer-only validation.
Collect consented, metadata-minimal evidence; never collect wallet secrets,
transaction hashes, memo references, addresses, or invoice/customer IDs.

## Completion criteria

For merchant setup, report success only when:

- the pinned release/build verifies;
- `config-validate` and network/PPOI `preflight` pass;
- the daemon is live and ready;
- authenticated runtime and metrics checks pass;
- the merchant signer is recorded through an independent payer trust channel;
- a backup/restore plan and real webhook receiver are documented.

For an end-to-end pilot, additionally require one actual private transfer to
reach `FINALIZED + SPENDABLE + MATCHED`, one exact-once confirmation at the
merchant application, and privacy-safe operator feedback. Never describe a
self-pilot as external adoption or a single successful run as production
readiness.
