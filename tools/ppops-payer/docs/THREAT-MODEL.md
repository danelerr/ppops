# Threat model

## Security objective

`ppops-payer` should make one bounded RAILGUN payment requested by a trusted
PPOps merchant without exposing payer spending material or silently changing
the recipient, token, chain, amount, memo or intent.

Gate A is diagnostic. It does not hide the public EVM address that signs and
pays gas for submission. Gate B removes that self-signer from submission by
using an operator-pinned RAILGUN Waku Broadcaster, but does not provide
network-layer anonymity.

## Assets

- payer RAILGUN recovery mnemonic and spending authority;
- self-signing EVM private key and its Arbitrum ETH;
- encrypted RAILGUN wallet database and its encryption key;
- payer RAILGUN address, balances, transaction history and private memos;
- merchant signer identity and signed PPOps request;
- Broadcaster fee-signer trust configuration, quote identity and maximum fee;
- reserved transaction nullifiers used to recover an ambiguous submission;
- RPC and PPOI credentials/metadata.

## Trust boundaries

```text
local secret files -> payer process -> RAILGUN Wallet SDK/artifacts
                                  -> RPC providers/PPOI nodes
PPOps request URL  -> signature verification -> bounded transaction
operator trust file -> Waku fee authorization -> selected Broadcaster
encrypted transaction -> Waku peers/Broadcaster -> Arbitrum
```

The operator trusts the local host, installed dependency lockfile, independently
pinned merchant signer, Arbitrum/RAILGUN contracts and configured external
providers. RPC and PPOI services are not assumed confidential or continuously
available.

## Main threats and controls

| Threat | Control | Residual risk |
| --- | --- | --- |
| Malicious checkout changes recipient or amount | Exact EIP-712 verification against an independently pinned signer; request/descriptor field equality | A compromised trusted merchant signing key can authorize a malicious request |
| Accidental wrong/large/expired payment | Arbitrum/native-USDC pinning, fresh `OPEN` request, exact intent confirmation, independent maximum atomic amount, and full live-request revalidation after proof generation | Operator can deliberately confirm the wrong valid intent; mining can still occur after expiry |
| Secret disclosure through arguments/logs | File-only secrets, owner/permission/symlink checks, stable redacted failures, executable privacy check | Compromised host/dependencies can read process memory |
| Secret committed to Git | `secrets/`, config, data and common key extensions ignored | Manually forcing an ignored file can still publish it |
| Wrong payer wallet imported | Persistent wallet identity plus mandatory expected 0zk address at submission | Operator can copy an already-wrong address instead of checking it out of band |
| Wrong public signer or excessive RPC fee | Mandatory expected EVM address, explicit maximum gas cost and public gas-balance check | A malicious dependency could still alter behavior after checks |
| Malicious/stale Broadcaster quote or excessive token fee | Owner-pinned trusted fee signers, exact native-USDC quote, reliability/lifetime floors, SDK-authorized fee range, explicit atomic fee ceiling and `payment + fee` balance check | Trusted fee signers, Waku client and selected Broadcaster remain external dependencies |
| Broadcaster redirects the populated call | Local proof/population pins the RAILGUN proxy, zero ETH value, exact recipient/memo/token/amount and pre-transaction PPOI data before encrypted submission | A compromised payer dependency can execute inside the secret-bearing process |
| Scan starts too late and misses funds | Explicit creation block at or before first relevant note | Incorrect operator input can produce an incomplete balance |
| Concurrent payer processes | Owner-only runtime lock spans wallet load, sync, proof generation and submission | A stale lock whose PID was reused can require operator cleanup |
| RPC outage or wrong chain | Two distinct configured RPC origins for SDK fallback; self-signer verifies chain ID and fee data | RAILGUN SDK fallback behavior and correlated providers remain dependencies |
| PPOI delay/block | Balance buckets are reported; `finalize-poi` binds proof generation to an exact `MINED` journal record and requires node acknowledgement; PPOps requires receiver `Spendable` | External list policy and node availability are outside the harness; chain mining does not imply PPOI completion |
| Transaction response lost after submission | The raw transaction is signed locally; its hash and nonce are persisted before broadcast, reuse is blocked, and receipt state advances through `SUBMITTED`, `MINED` or `REVERTED` | RPC/receipt failure still requires resolving the recorded public hash before any new intent is paid |
| Broadcaster response lost after Waku submission | Intent, fee fingerprint and nullifiers are persisted before Waku; recovery resolves a public hash from the original full wallet; two RPCs must agree on receipts; the same intent remains blocked | A reservation can remain unresolved indefinitely; operator must not delete it to force a retry |
| Public sender correlation | Explicit Gate A warning | Inherent to self-signing; Gate B Broadcaster is required for the final privacy claim |
| Network metadata correlation | Broadcaster transaction content is encrypted, but RPC, PPOI, artifact, DNS/Waku and Broadcaster connections originate from the payer host | No Tor/mixnet guarantee; timing and IP-layer analysis remain possible |
| Supply-chain compromise | Exact dependency lockfile, build/tests, audit gate | Official RAILGUN tree retains low/moderate legacy transitive findings and downloaded proving artifacts remain trusted inputs |

## Explicit non-goals

- protecting secrets on a compromised payer host;
- anonymous network access to RPC, PPOI, artifact or Waku services;
- hiding Gate A's public self-signing EVM address;
- hiding payer host network metadata or proving resistance to timing analysis;
- key recovery, hardware-wallet custody or multi-user wallet management;
- bypassing RAILGUN PPOI/standby rules;
- guaranteeing merchant fulfillment after PPOps reconciliation.

## Operational rules

1. Never place payer spending material on the PPOps merchant host.
2. Keep runtime config, secrets, LevelDB and evidence outside public artifacts.
3. Back up the recovery mnemonic independently; the encrypted local database is
   a cache, not the sole wallet backup.
4. Use a fresh intent and verify the expected signer immediately before payment.
5. Treat the self-signed path as Gate A evidence only; a passing Broadcaster
   payment can support only the narrower claim that the payer self-signer was
   not used for submission.
6. After mining, finalize PPOI from the existing journal record; never resend the
   payment merely because the receiver still reports `MissingExternalPOI`.
7. Review Broadcaster signer rotation independently and preserve the local trust
   fingerprint. Never fetch mutable trust configuration inside a payment.
