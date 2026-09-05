# Contributing

Keep v0.1 scoped to view-only RAILGUN reconciliation. Checkout clarity, developer
tools and documentation belong in that scope. New spending authority, rails,
hosted relays or cryptography need a separate design discussion.

Start with `npm ci`, `npm run demo` and the documentation index. Merchant-only
work does not require installing the payer. Before submitting merchant changes,
run `npm run verify` and `npm run test:package`. For the full independent payer
and release suites:

Before submitting a change:

```bash
npm ci
npm run payer:install
npm run verify:all
```

API changes must update the shared schemas and `npm run docs:generate`.
Examples must preserve idempotency across retries and execute without fixed
past timestamps. CLI changes require per-command help and safe diagnostic hints.
Run `npm run test:package -- --install` to check a clean packaged dependency install.
Do not describe local demo output as real-payment or external-adoption evidence.

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
