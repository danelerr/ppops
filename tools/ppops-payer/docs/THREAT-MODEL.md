# Threat model

## Security objective

`ppops-payer` should make one bounded RAILGUN payment requested by a trusted
PPOps merchant without exposing payer spending material or silently changing
the recipient, token, chain, amount, memo or intent.

Gate A is diagnostic. It does not hide the public EVM address that signs and
pays gas for submission.

## Assets

- payer RAILGUN recovery mnemonic and spending authority;
- self-signing EVM private key and its Arbitrum ETH;
- encrypted RAILGUN wallet database and its encryption key;
- payer RAILGUN address, balances, transaction history and private memos;
- merchant signer identity and signed PPOps request;
- RPC and PPOI credentials/metadata.

## Trust boundaries

```text
local secret files -> payer process -> RAILGUN Wallet SDK/artifacts
                                  -> RPC providers/PPOI nodes
PPOps request URL  -> signature verification -> bounded transaction
```

The operator trusts the local host, installed dependency lockfile, independently
pinned merchant signer, Arbitrum/RAILGUN contracts and configured external
providers. RPC and PPOI services are not assumed confidential or continuously
available.

## Main threats and controls

| Threat | Control | Residual risk |
| --- | --- | --- |
| Malicious checkout changes recipient or amount | Exact EIP-712 verification against an independently pinned signer; request/descriptor field equality | A compromised trusted merchant signing key can authorize a malicious request |
| Accidental wrong/large/expired payment | Arbitrum/native-USDC pinning, fresh `OPEN` request, exact intent confirmation, independent maximum atomic amount and expiry recheck immediately before submission | Operator can deliberately confirm the wrong valid intent; mining can still occur after expiry |
| Secret disclosure through arguments/logs | File-only secrets, owner/permission/symlink checks, stable redacted failures, executable privacy check | Compromised host/dependencies can read process memory |
| Secret committed to Git | `secrets/`, config, data and common key extensions ignored | Manually forcing an ignored file can still publish it |
| Wrong payer wallet imported | Persistent wallet identity plus mandatory expected 0zk address at submission | Operator can copy an already-wrong address instead of checking it out of band |
| Wrong public signer or excessive RPC fee | Mandatory expected EVM address, explicit maximum gas cost and public gas-balance check | A malicious dependency could still alter behavior after checks |
| Scan starts too late and misses funds | Explicit creation block at or before first relevant note | Incorrect operator input can produce an incomplete balance |
| Concurrent payer processes | Owner-only runtime lock spans wallet load, sync, proof generation and submission | A stale lock whose PID was reused can require operator cleanup |
| RPC outage or wrong chain | Two distinct configured RPC origins for SDK fallback; self-signer verifies chain ID and fee data | RAILGUN SDK fallback behavior and correlated providers remain dependencies |
| PPOI delay/block | Balance buckets are reported; payment requires `Spendable` | External list policy and node availability are outside the harness |
| Transaction response lost after submission | Owner-only write-ahead journal reserves the intent before broadcast, blocks reuse and records the hash when returned | An RPC failure after broadcast can leave `SUBMITTING` ambiguous and still requires nonce/chain inspection |
| Public sender correlation | Explicit Gate A warning | Inherent to self-signing; Gate B Broadcaster is required for the final privacy claim |
| Supply-chain compromise | Exact dependency lockfile, build/tests, audit gate | Official RAILGUN tree retains low/moderate legacy transitive findings and downloaded proving artifacts remain trusted inputs |

## Explicit non-goals

- protecting secrets on a compromised payer host;
- anonymous network access to RPC, PPOI, artifact or Waku services;
- hiding Gate A's public self-signing EVM address;
- key recovery, hardware-wallet custody or multi-user wallet management;
- bypassing RAILGUN PPOI/standby rules;
- guaranteeing merchant fulfillment after PPOps reconciliation.

## Operational rules

1. Never place payer spending material on the PPOps merchant host.
2. Keep runtime config, secrets, LevelDB and evidence outside public artifacts.
3. Back up the recovery mnemonic independently; the encrypted local database is
   a cache, not the sole wallet backup.
4. Use a fresh intent and verify the expected signer immediately before payment.
5. Treat the self-signed path as Gate A evidence only; use Broadcaster submission
   before claiming end-to-end sender privacy.
