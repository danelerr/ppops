# PPOps RAILGUN primitive gate

Date: 2026-08-23

Decision: **GO for PPOps v0.1-R implementation.** This is a primitive-feasibility
decision, not a production-readiness claim.

The gate demonstrates that a receiver initialized only from a RAILGUN shareable
viewing key can recover a private ERC-20 settlement's encrypted PPOps memo,
amount, token, public transaction hash, output coordinates, block information,
and PPOI-derived balance bucket. It cannot access the full-wallet API or sign a
spend. The same settlement survives a database restart without a duplicate event.

## Stable settlement identity

The implementation discovery changed the proposed identifier. PPOps should use:

```text
chainId
+ txidVersion
+ normalized public transaction hash
+ UTXO tree
+ UTXO position
```

`reference` is not unique because one intent may receive multiple settlements.
`tree + position` alone is not reorg-safe. `transactCreationRailgunTxid` cannot be
required because it was `null` in both the controlled V2 transfer and the sampled
live Sepolia notes.

## What ran

1. `npm run kill:structural`
   - imports only a shareable viewing key;
   - rejects the full-wallet accessor and signing;
   - reloads the encrypted LevelDOWN database.
2. `npm run kill:encrypted-leaf`
   - creates and encrypts `ppops:v1:0x<bytes32>` with RAILGUN V2 primitives;
   - scans the resulting commitment leaf with a view-only wallet;
   - verifies memo, token, amount, transaction identifiers and restart recovery.
3. `PPOPS_KILL_ACCEPT_ANY_MEMO=1 npm run kill:scan`, twice
   - scans a public upstream fixture on Ethereum Sepolia through a real RPC and
     the documented test PPOI endpoint;
   - discovers 70 ERC-20 TXOs, including two encrypted memos;
   - emits two journal entries on the first run and zero on the second.
   - the `any memo` switch is test-only; normal matching remains strict
     `ppops:v1` parsing and the fixture memo values are stored as hashes.
4. A patched official engine integration test on Hardhat
   - deploys the RAILGUN V2 contract;
   - shields funds, generates a real 1-input/2-output Groth16 proof and submits a
     private transfer with a PPOps memo;
   - starts the receiver as view-only before submission;
   - reports `Valid` raw PPOI test status, `Spendable`, token, amount, public tx
     hash, tree/position and restart-stable identity;
   - rejects spending from the receiver.

The exact upstream changes are preserved in
`patches/railgun-contract-lightweight-gate.patch` and
`patches/railgun-engine-view-only-gate.patch`. The contract patch replaces the
full ~1 GB circuit-test bundle with only the 1x2 verification key already pinned
in the engine test fixtures.

## Boundaries and risks

- The live Sepolia fixture demonstrated real PPOI-derived buckets
  (`MissingExternalPOI`, `ShieldPending`, `Spent`), but none of its historical
  notes returned a raw `Valid` PPOI entry. `Valid -> Spendable` was demonstrated
  with the official in-repo test PPOI interface. A fresh PPOI-enabled testnet
  payment remains an operational beta test, not a primitive blocker.
- The high-level wallet history is insufficient for exact per-output identity;
  PPOps needs the engine's TXO surface (`tree`, `position`). Pin and regression-test
  that dependency.
- The pinned SDK leaves timeout handles after graceful cleanup. The finite test
  CLI exits via a documented watchdog after provider/engine shutdown; a daemon
  must test bounded SIGTERM behavior separately.
- The upstream trees include deprecated dependencies and audit findings. Treat
  the SDK as a security-sensitive isolated dependency and do not auto-upgrade it.
- The gate uses Node's experimental `node:sqlite`; choose a supported SQLite
  driver for the actual daemon unless this runtime constraint is accepted.

The machine-readable evidence is in `artifacts/primitive-gate-report.json`.
