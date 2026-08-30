# RAILGUN Broadcaster interoperability report

Status: maintainer-ready, metadata-minimal diagnostic. This is not a successful
payment report and contains no wallet address, nullifier, memo, intent ID,
signature, fee-signer value, RPC credential or raw encrypted payload.

## Summary

On Arbitrum One with native USDC, the pinned official Wallet SDK and Waku client
can discover authorized Broadcasters, build a V2 private ERC-20 transfer, create
its proof and populate calldata that succeeds under three independent
`eth_estimateGas` calls. A bounded funded trial nevertheless received no usable
transaction hash from two selected Broadcaster identities. One encrypted server
response was the sanitized `Unknown Broadcaster error.`; another client/send
failure could not be classified. Nullifier-based recovery found no canonical
transaction and the payer balance did not change.

The local payer correctly keeps those outcomes ambiguous and will not issue a
fresh spend. Assistance is needed at the Broadcaster's private validation/send
boundary; additional blind value-bearing retries are not useful.

## Versions and profile

```text
network                              Arbitrum One (42161)
asset                                native USDC
RAILGUN TXID version                 V2 Poseidon Merkle
@railgun-community/wallet            10.9.0
@railgun-community/engine            9.6.0
@railgun-community/shared-models      8.0.1
waku-broadcaster-client-node          9.1.1
Node.js                               >=22 (CI uses pinned Node 24)
```

The fee-signer list and Waku pubsub topic were pinned locally from an
independently reviewed configuration. Quote admission required the expected
network/token, a trusted signature, supported version, positive fee,
reliability/lifetime floors and enough available wallets.

## Reproduced facts

1. A non-financial preflight repeatedly obtained at least five LightPush and
   five Filter peers and valid native-USDC quotes.
2. A no-send run synchronized a full payer, calculated a bounded fee, generated
   the transfer proof, populated the proxy transaction and wrote no journal or
   Waku message.
3. A later no-send diagnostic used the same production preparation path and
   observed:

   ```text
   Wallet SDK pre-proof gas estimate   1128365
   final populated call estimate       1123239
   final simulation RPC agreement      3 of 3
   point-in-time token fee              64892 atomic USDC
   payment submitted                    false
   journal record created               false
   ```

4. The funded lineage sent one initial encrypted request and three bounded
   same-nullifier variants. The first three targeted one selected identity; the
   last excluded it and selected a second identity from 14 eligible unique
   identities.
5. No attempt returned a usable hash. One selected Broadcaster returned the
   server's sanitized `UNKNOWN_ERROR`; another path ended in an unclassified
   post-send client/transport error.
6. Recovery more than 15 minutes after the final attempt found no canonical
   transaction for the reserved nullifiers. The private balance and receiver
   intent remained unchanged. No fee was observed as charged.
7. A later fresh-intent preparation generated a proof, but its read-only journal
   admission check found that at least one selected input belonged to the
   unresolved lineage. It returned `SUBMISSION_ALREADY_RECORDED` before final
   simulation or Waku. No new journal record or payment was created.

## Interpretation

The final on-chain simulation executes the exact target and calldata, including
proof verification, under three public RPC views. It makes malformed final
calldata or an invalid proof an unlikely cause of this specific result. It does
not reproduce the selected Broadcaster's funded sender, provider, cached fee,
fee-note extraction, PPOI validation, wallet selection, nonce management or
send runtime.

The reference server converts any non-allowlisted internal error to
`Unknown Broadcaster error.` when `devLog` is false. That response therefore
does not identify which private stage failed, and it cannot prove that the
Broadcaster did not reach its chain-send boundary.

The follow-up admission result also means the Wallet SDK's current `Spendable`
balance cannot safely be used as fresh diagnostic capital. Resolving the old
lineage or providing independently fresh inputs is a prerequisite for another
funded attempt; increasing the fee ceiling is not.

## Maintainer questions

1. Is client `9.1.1` expected to interoperate with every Broadcaster version
   admitted by its advertised min/max version range on Arbitrum?
2. Which server stages can currently produce a non-allowlisted error after
   successful decryption: gas-wallet selection, gas estimation, fee extraction,
   fee-cache validation, PPOI validation, transaction execution or RPC send?
3. Can production responses expose a stable, non-sensitive stage/error code
   while keeping raw provider and transaction errors sanitized?
4. Is there a supported way for a controlled client to request detailed error
   categories without setting the package-global development flag or exposing
   transaction secrets?
5. Is regeneration with the exact same nullifiers but a new proof, fee ID and
   different Broadcaster identity an officially supported recovery operation?
6. Can maintainers provide a local integration fixture that validates the
   encrypted request through fee extraction and PPOI checks without sending a
   public transaction?

## Reproduction references

- PPOps final-call and prepare-admission guards: commits
  [`b6d5e3d`](https://github.com/danelerr/ppops/commit/b6d5e3dee1d39968a2ae96c5827e65e84d87124e)
  and
  [`d70057e`](https://github.com/danelerr/ppops/commit/d70057e)
- Passing public verification:
  [GitHub Actions run 33337619615](https://github.com/danelerr/ppops/actions/runs/33337619615)
- Full bounded workflow and outcome: [Gate B runbook](GATE-B.md)
- Security disposition:
  [Broadcaster differential review](../../../PPOPS_DIFFERENTIAL_REVIEW_2026-08-30.md)

The maintainers can reproduce the client-side boundary with
`prepare-broadcaster`: it performs full proof/population and exact-call quorum
simulation, but deliberately creates no encrypted Waku request and moves no
funds. A new funded reproduction should use fresh, independently bounded funds
and must not reuse or delete the unresolved lineage recorded above.
