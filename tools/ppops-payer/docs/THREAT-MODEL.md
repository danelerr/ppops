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
- ephemeral shield ownership key when separate funding tooling is used;
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
| Incorrect shield-key derivation | Tested fixed-message signature validation followed by `keccak256`; raw signatures and derived keys are never printed | Public funding/shielding remains outside the payment harness and links its EVM sender onchain |
| Secret committed to Git | `secrets/`, config, data and common key extensions ignored | Manually forcing an ignored file can still publish it |
| Wrong payer wallet imported | Persistent wallet identity plus mandatory expected 0zk address at submission | Operator can copy an already-wrong address instead of checking it out of band |
| Wrong public signer or excessive RPC fee | Mandatory expected EVM address, explicit maximum gas cost and public gas-balance check | A malicious dependency could still alter behavior after checks |
| Malicious/stale Broadcaster quote or excessive token fee | Owner-pinned trusted fee signers, native-USDC quote validation, reliability/lifetime floors, SDK-authorized fee range, explicit atomic fee ceiling and `payment + fee` balance check; after proof, exact quote is preferred and rotation is accepted only with identical Broadcaster/token/fee rate | Trusted fee signers, Waku client and selected Broadcaster remain external dependencies; a compatible fee-ID rotation still relies on the Broadcaster retaining that authorized quote |
| Broadcaster redirects the populated call | Local proof/population pins the RAILGUN proxy, zero ETH value, exact recipient/memo/token/amount and pre-transaction PPOI data before encrypted submission | A compromised payer dependency can execute inside the secret-bearing process |
| Scan starts too late and misses funds | Explicit creation block at or before first relevant note | Incorrect operator input can produce an incomplete balance |
| Concurrent payer processes | Owner-only runtime lock spans wallet load, sync, proof generation and submission | A stale lock whose PID was reused can require operator cleanup |
| RPC outage, wrong chain or gas-price outlier | At least two distinct configured origins; 15-second local deadlines; strict healthy majority; upper-median gas selection; explicit fee ceilings; strict identical-receipt quorum | RAILGUN SDK fallback behavior, a high outlier in a two-provider profile and correlated providers remain dependencies |
| PPOI delay/block | Balance buckets are reported; `finalize-poi` binds proof generation to an exact `MINED` journal record and requires node acknowledgement; PPOps requires receiver `Spendable` | External list policy and node availability are outside the harness; chain mining does not imply PPOI completion |
| Transaction response lost after submission | The raw transaction is signed locally; its hash and nonce are persisted before broadcast, reuse is blocked, and receipt state advances through `SUBMITTED`, `MINED` or `REVERTED` | RPC/receipt failure still requires resolving the recorded public hash before any new intent is paid |
| Broadcaster lies about, rejects or loses the response after Waku submission | Intent, payer, exact quote, bounded fee and nullifiers are persisted before Waku; the returned hash remains only a report; recovery first derives canonical identity from those nullifiers; a strict RPC majority must agree on receipts. An explicit ambiguity retry must preserve the signed request, payer and complete nullifier set, exclude every attempted Broadcaster identity and stay within a three-retry cap. Any unresolved nullifier is barred from a different intent | The reservation can remain unresolved indefinitely after the cap; distinct 0zk identities need not be independent operators; a compromised full-wallet SDK could misderive identity; the operator must not delete or bypass the journal to force a fresh spend |
| Public sender correlation | Explicit Gate A warning and separate Gate B path | Inherent to Gate A self-signing; the passing Gate B self-pilot supports only the narrower claim that this submission used no payer EVM self-signer |
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
8. Treat `reportedTransactionHash` as diagnostic metadata only. Continue
   recovery until `canonicalTransactionHashResolved` is true; never inspect the
   reported hash and infer that payment succeeded.
9. After an ambiguous Gate B response, run `recover-broadcaster` before any
   retry. Use `retry-broadcaster` only when the command reports it available;
   it regenerates a conflicting variant for the exact same nullifiers and
   excludes identities already attempted.
10. Never pay a different intent with nullifiers held by a nonterminal
    Broadcaster journal record. The journal enforces this locally; do not delete
    or edit it to bypass the check.
11. After three retry reservations, stop. There is no timeout after which an
    unknown external submission becomes safe to ignore; resolve it manually or
    obtain definitive rejection/reversion evidence before releasing the notes.
