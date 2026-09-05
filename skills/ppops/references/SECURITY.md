# PPOps security rules

These rules are mandatory.

## Merchant daemon

- Accept only a RAILGUN shareable viewing key.
- Never request or load a merchant mnemonic, spending key, full wallet backup,
  or payer secret.
- Treat the viewing key as confidential financial metadata: it reveals the
  receiver's private history even though it cannot spend.
- Store config and secret values in separate regular, non-symlink, owner-only
  files. Pass file paths, not secret values.
- Bind to loopback by default. If remote access is required, place an
  authenticated TLS reverse proxy/private network in front and keep the PPOps
  API token server-side.
- Use independent merchant-signing, API, database-encryption, and webhook keys.
- Publish the expected merchant signer through a channel independent of the
  checkout/request URL.

## Payer

- Run tools/ppops-payer in a separate trust domain.
- Never copy payer secrets to the merchant host or evidence bundle.
- Verify request signature, chain, token, amount, expiry, recipient, and
  expected signer before proof generation.
- Run prepare/no-send first. A send requires explicit approval of amount and fee
  ceilings.
- Treat ambiguous submission as pending/recovery work, never permission to
  retry with new notes.

## Reconciliation

- Never weaken finality, PPOI, matching, quorum, or exact-once requirements to
  regain availability.
- Never manually mark an intent paid.
- Never infer successful payment from a transaction hash or public receipt
  alone.
- Do not fulfill twice: verify HMAC, timestamp, schema, and event-ID uniqueness
  atomically.

## Evidence

Exclude viewing/spending material, API and HMAC keys, RPC credentials,
transaction hashes, 0zk/EVM addresses, encrypted memo references,
externalReference, invoice/customer identifiers, and raw logs containing any
of them.

Read repository SECURITY.md, docs/SECURITY.md, and docs/THREAT-MODEL.md before
handling real value.
