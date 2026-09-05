# Operator security

This document is the onboarding security checklist. The root
[SECURITY.md](../SECURITY.md) defines the project security policy and reporting
process; [THREAT-MODEL.md](THREAT-MODEL.md) is the detailed design analysis.

## Trust domains

~~~text
merchant wallet device             PPOps host                 payer host
----------------------             ----------                 ----------
receiver spending key              viewing key only           payer mnemonic
receiver seed/backups       X       API/signing/HMAC keys      spending wallet
                                     local reconciliation       submission journal
~~~

The merchant spending wallet and payer never belong on the PPOps host.

## Merchant secret inventory

PPOps uses separate files for:

- RAILGUN shareable viewing key: reads the receiver's private history;
- API token: authenticates merchant API callers;
- merchant EIP-712 signing key: signs payment descriptors;
- RAILGUN database-encryption key: protects local Wallet SDK state at rest;
- webhook HMAC key: authenticates outbound events.

Use independent random values. Keep files regular, non-symlink, owner-only
(0600), excluded from Git and backups unless an explicit encrypted recovery
procedure includes them.

The viewing key cannot spend, but exposure discloses private financial metadata.
It cannot be revoked for an existing wallet. Treat a compromise as a privacy
incident and move future receiving activity to a newly created receiver outside
PPOps.

## Non-negotiable rules

- Never give PPOps a seed phrase, spending key, full wallet export, or payer
  wallet backup.
- Never pass secrets as CLI arguments or URLs.
- Never log invoice/customer data, viewing material, memo references, or
  credential-bearing provider URLs.
- Never accept a descriptor signer solely because the descriptor names it.
- Never mark OBSERVED, FINALIZED, MATCHED, or a public receipt as paid.
- Never weaken finality, PPOI, matching, RPC majority, or idempotency to improve
  availability.
- Never retry an ambiguous payer submission blindly.
- Never fulfill a webhook before raw-body HMAC, timestamp, schema, event-ID,
  intent mapping, and deduplication checks.

## Descriptor identity

The merchant signs each descriptor with a key independent of the RAILGUN
spending key. A payer must pin the expected signer through a merchant-controlled
channel outside the checkout URL. Examples include a signed website
configuration, verified integration settings, or a previously pinned operator
record.

## API and checkout exposure

Bind to 127.0.0.1 by default. Keep Bearer-authenticated /v1 endpoints private.
Expose payer checkout routes only through TLS and an explicit reverse-proxy
allowlist.

Checkout IDs are high-entropy capabilities but not authentication for merchant
operations. Use no-store/no-referrer headers and do not include checkout URLs in
analytics, support tickets, or public evidence.

## Fulfillment

Treat PPOps as a payment oracle with strict state criteria, not an
authorization to spend. The merchant backend must:

1. verify HMAC over the raw body;
2. enforce a short timestamp tolerance;
3. validate event schema and header/body event-ID equality;
4. resolve the PPOps intent to its local order;
5. insert the event ID under a unique constraint;
6. fulfill and commit atomically;
7. return 2xx for already applied valid duplicates.

## Operational safety

- Use three independent RPC origins when possible.
- Monitor readiness, scan age/failures, outbox pending/dead letters, memory,
  disk, and restarts.
- Stop and drain scans before backups or upgrades.
- Test isolated restore, including access to the separately stored secrets.
- Rotate API/webhook/signing identities deliberately and distribute a new
  expected signer before invalidating the old channel.
- Keep evidence metadata-minimal. Redaction after publishing is not a privacy
  control.

## Current limitations

- The payer needs RAILGUN-compatible spending software and existing Spendable
  private liquidity.
- The initial shield/PPOI onboarding experience can be slow.
- Broadcaster availability and network-layer anonymity are not guaranteed by
  PPOps.
- The beta has controlled mainnet evidence, not an independent security audit or
  broad production adoption.
- PPOps protects reconciliation metadata; RAILGUN provides payment privacy.

Report vulnerabilities using the private process in the root security policy.
