# Merchant integration

Read docs/MERCHANT-INTEGRATION.md, docs/API.md and docs/PAYMENT-STATES.md in the
selected PPOps source checkout. Those are the canonical contracts; this skill
does not maintain a separate schema or fixed-date payment example.

Use the optional source package HTTP helpers or raw HTTP. Keep the API token on
the merchant backend, persist amount/expiry before POST and preserve key/body on
ambiguous retries. Verify raw webhook bytes and commit deduplication with order
fulfillment. The runnable example is documented in examples/README.md.
