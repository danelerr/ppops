# Security policy

PPOps v0.1 is beta software handling highly sensitive viewing capability and
commercial payment metadata. The merchant daemon does not hold a RAILGUN
spending key, but a compromise can still reveal the merchant's private payment
graph. The separate `tools/ppops-payer` gate does hold payer spending authority
and must run under a different trust domain.

## Reporting a vulnerability

Use the repository host's private security-advisory/reporting channel. Do not
open a public issue containing exploit details, viewing keys, API tokens,
merchant signing keys, webhook keys, database material or private payment
metadata. If no private channel is enabled, contact the repository owner before
sharing a proof of concept.

Include the affected version, deployment model, minimal reproduction and impact.
Use synthetic keys and testnet data whenever possible.

## Supported version

Only the latest `0.1.x` beta receives fixes. No version is currently designated
production-ready.

## Security invariants

- The merchant runtime accepts a shareable RAILGUN viewing key, never a mnemonic
  or RAILGUN spending key.
- The payer harness is excluded from the merchant TypeScript build and Docker
  image and may communicate with PPOps only through a signed payment request.
- Configuration, wallet state, viewing key, API token, merchant signing key,
  RAILGUN DB key and webhook key are separate owner-only regular files. Symlinks,
  oversized files and POSIX group/other access are rejected.
- Commercial references remain in authenticated local API traffic and SQLite;
  they are absent from payer descriptors, public RAILGUN artifacts, application
  logs and outbound events.
- A payment is not credited before chain finality and PPOI spendability.
- Descriptor trust is rooted in an expected merchant signer distributed through
  a separate trusted channel.
- Webhook URLs are operator configuration, not API input.

Run `npm run privacy:test` when changing any security-critical path.
Run `npm run verify:all` when changing the repository boundary or payer harness.

## Known beta risks

- The pinned RAILGUN SDK/engine dependency graph remains large. Compatible
  overrides currently leave moderate/low findings only; CI rejects any new high
  or critical production finding and publishes a CycloneDX SBOM.
- Viewing-key or host compromise discloses payment history and memos.
- RPC and PPOI endpoints observe network requests and timing and can affect
  availability or feed incomplete state.
- PPOps has bounded in-process API, authentication-failure and checkout rate
  limits. The documented deployment is still local/private and single-merchant;
  an Internet-facing proxy must add TLS, distributed limits and its own access
  controls.
- Backup bundles created with `--include-secrets` are sensitive and are not
  additionally encrypted by PPOps.
- Backup SHA-256 inventories detect corruption but do not authenticate an
  attacker-controlled bundle.
- Gate A self-signing links the payer's public EVM address to the RAILGUN
  transaction. It is diagnostic evidence, not the final sender-privacy path;
  Gate B still requires Broadcaster submission.
- The payer's write-ahead journal blocks automatic reuse of an intent. Gate A
  resolves ambiguity through its precomputed hash and nonce. Gate B stores a
  Waku-reported hash separately and accepts only the canonical hash recovered
  from reserved nullifiers. Any unresolved record remains intentionally
  fail-closed; deleting the journal to retry can double-pay.
- The controlled Gate A payment and signed Mainnet Gate artifact pass. A fresh
  Gate B no-send proof preparation also passes. A fresh value-bearing Gate B
  payment and independently operated pilot evidence are still required before
  any sender-unlinkability or production-readiness claim.

See `docs/OPERATIONAL-PROFILE.md` and `docs/ppops-threat-model.md` for detail.
