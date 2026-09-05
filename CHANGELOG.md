# Changelog

## 0.1.0-beta.2 — unreleased

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

The new version has not been published. Historical Gate A/B reports apply to
their recorded code and remain unchanged; no new mainnet or external pilot is
claimed for this release candidate.

## 0.1.0-beta.1

Published controlled-pilot baseline. See the dated reports under artifacts/ and
the historical operational profile for the evidence and scope of that release.
