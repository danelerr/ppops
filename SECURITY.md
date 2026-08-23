# Security policy

PPOps v0.1 is beta software handling highly sensitive viewing capability and
commercial payment metadata. It does not hold a RAILGUN spending key, but a
compromise can still reveal the merchant's private payment graph.

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

- The runtime accepts a shareable RAILGUN viewing key, never a mnemonic or
  spending key.
- The viewing key, API token, merchant signing key, RAILGUN DB key and webhook
  key are separate mode-`0600` files.
- Commercial references remain in authenticated local API traffic and SQLite;
  they are absent from payer descriptors, public RAILGUN artifacts, application
  logs and outbound events.
- A payment is not credited before chain finality and PPOI spendability.
- Descriptor trust is rooted in an expected merchant signer distributed through
  a separate trusted channel.
- Webhook URLs are operator configuration, not API input.

Run `npm run privacy:test` when changing any security-critical path.

## Known beta risks

- The pinned RAILGUN SDK/engine dependency graph has unresolved npm audit
  findings, including critical findings in legacy transitive Web3/BZZ packages.
- Viewing-key or host compromise discloses payment history and memos.
- RPC and PPOI endpoints observe network requests and timing and can affect
  availability or feed incomplete state.
- There is no rate limiter. The documented deployment is local/private and
  single-merchant; an Internet-facing proxy must add TLS, request limits and its
  own access controls.
- Backup bundles created with `--include-secrets` are sensitive and are not
  additionally encrypted by PPOps.
- Backup SHA-256 inventories detect corruption but do not authenticate an
  attacker-controlled bundle.

See `docs/OPERATIONAL-PROFILE.md` and `docs/ppops-threat-model.md` for detail.
