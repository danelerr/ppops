# Merchant setup

Read docs/QUICKSTART.md from the selected source checkout. New beta.2 onboarding
is unreleased and is not included in the published beta.1 tag.

For evaluation use npm run demo. For a real instance, use the canonical guide's
viewing-key setup, explicit profile/providers, doctor --offline, preflight,
serve and status sequence. Wallet funding and initial scanning have no fixed
fifteen-minute guarantee.

The repository scripts/verify-install.sh verifies the merchant by default;
--with-payer adds the separate payer suite. The skill's shell entrypoints are
compatibility wrappers. They are not a separate installation mechanism.

Accept only secret file paths. Keep payer spending material on the payer host
and obtain explicit authorization before any actual payment.
