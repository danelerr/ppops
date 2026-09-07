# Changelog

## 0.1.0-beta.3 — 2026-09-07

- Name the incoming-payment product PayIn; keep Payout/refunds in a conditional roadmap.
- Add browser-side signed-request verification and optional independent public-signer comparison.
- Introduce a white/purple checkout with payment-language progress, advanced details,
  local request-link QR and copy/download handoff. No wallet connector is implied.
- Expose additive paymentStage and overpaymentAmountAtomic public presentation fields.
- Preserve FINALIZED + SPENDABLE + MATCHED acceptance, existing intent statuses and payment.confirmed.
- Add reference-payer readiness with exact balance/fee-budget arithmetic; no submission or estimated wait.
- Accept additive public request fields in the payer while retaining signed-field verification.
- Document Payment Request v1, privacy boundaries and separate payer usability targets.

These changes follow published beta.2. No new real-money pilot, wallet compatibility
or independent usability result is claimed.

The reference payer is version 0.1.0-alpha.1. Existing beta.0–beta.2 backup manifests
remain restorable. Build/install the merchant and payer from this same source tag.

## 0.1.0-beta.2 — 2026-09-06

- Add an isolated local demo, runnable merchant example and TypeScript HTTP helpers.
- Add doctor/status, per-command help, standard version output and actionable errors.
- Default initialization to Arbitrum/native USDC; custom test networks must be explicit.
- Add a container initialization flow with portable instance paths.
- Refresh checkout state automatically and explain partial, expired, late and offline states.
- Add shared API schemas, generated OpenAPI and raw-body webhook verification helpers.
- Reorganize onboarding around trying, integrating and operating the daemon.
- Correct expiry examples and document partial-payment semantics without changing settlement rules.
- Keep historical pilot evidence separate from current behavior and release claims.

Compatibility: existing v1 HTTP fields and settlement semantics remain. Error
responses can include hints/field details; init now defaults to Arbitrum instead
of Sepolia, and its next field is a list of steps. Clients should tolerate
additive response fields. Back up and review config before upgrading.

Historical Gate A/B reports apply to their recorded code and remain unchanged;
no new mainnet or external pilot is claimed for this release.

## 0.1.0-beta.1

Published controlled-pilot baseline. See the dated reports under artifacts/ and
the historical operational profile for the evidence and scope of that release.
