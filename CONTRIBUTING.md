# Contributing

Keep v0.1 narrowly scoped to view-only RAILGUN reconciliation. Proposals for a
UI, another rail, Request Network, hosted relays, HPKE, new Solidity or new
cryptography should be discussed separately and must not expand the beta core.

Before submitting a change:

```bash
npm ci
npm run payer:install
npm run verify:all
```

Never commit real viewing keys, API tokens, merchant signing keys, webhook keys,
commercial references or generated merchant databases. Tests must use public or
ephemeral fixtures. Changes to settlement identity, finality, PPOI mapping,
descriptor encoding, secret handling, webhook signing, backup or restore require
new regression coverage and an update to the operational profile and threat
model.

Code under `src/` must never import `tools/ppops-payer`, accept a RAILGUN
mnemonic/spending key or copy payer state into the merchant image. Payer tooling
must not import merchant runtime internals; the signed `request.json` schema is
their only application-level interface. `npm run trust-boundary:check` enforces
these repository rules.

Dependency upgrades to RAILGUN packages are security-sensitive: rerun the
primitive gate and compare direct TXO fields and restart identity before merging.
