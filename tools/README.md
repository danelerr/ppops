# Repository tools

Tools in this directory are independently installed and executed. They are not
linked into the PPOps merchant daemon or copied into its production image.

## `ppops-payer`

`ppops-payer` is a mainnet-gate harness that holds payer-side RAILGUN spending
authority. It verifies a signed PPOps request and can produce a bounded private
transfer. Its trust boundary is intentionally opposite to the reconciler:

| Component | Runtime role | Secret authority |
| --- | --- | --- |
| `src/` | Merchant receiver/reconciler | RAILGUN viewing capability only |
| `tools/ppops-payer/` | Independent payer diagnostic | Payer mnemonic and EVM self-signing key |

Sharing one Git repository does not authorize sharing a host, process, database,
configuration or secret mount. A production merchant deployment builds only the
root package and `src/`; the payer runs on the payer-controlled host.

Install and verify everything from the repository root:

```bash
npm ci
npm run payer:install
npm run verify:all
```

See [`ppops-payer/README.md`](ppops-payer/README.md) for its controlled Gate A
runbook.
