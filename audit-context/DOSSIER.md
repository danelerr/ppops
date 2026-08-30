# PPOps audit context dossier

Context-building snapshot: 2026-08-30. This document describes the source tree
through Gate B prepare-time nullifier admission remediation commit
`d70057e`. Review began from root commit
`89256e9e2fa2f4d388c9b2dd96adb5ef588fe8ef`; the payer subtree was originally
imported from commit
`300bcb7c5a52ad7955ce317f15a120b3138c48e6`. This is an orientation record, not
a vulnerability report, severity assessment, or production-readiness claim.
The 2026-08-30 extension maps the current Gate B Broadcaster submission and
recovery flow; the separate security-review documents are not part of this
context-building analysis.

Ignored runtime state and secret/configuration contents were not opened. In
particular, no contents under `secrets/`, `data/`, `instance/`, `backups/`,
`restore/`, `pilot/`, `pilot-evidence/`, or `tools/ppops-payer/{secrets,data,artifacts}`
were inspected. The path `justito-hackathon-deck.html` was not read or modified.

## System shape

The repository contains two independently executable Node/TypeScript packages:

1. `ppops` is a merchant-side view-only reconciler. Its binary is
   `dist/cli.js` (`package.json:L27-L29`). It accepts a RAILGUN shareable viewing
   key, an independent merchant EIP-712 key, an API token, an encrypted-wallet
   database key, and optionally a webhook HMAC key
   (`src/runtime.ts:L41-L72`). It creates payment intents, watches receiver
   notes, derives payment state, and emits an outbox/webhook.
2. `tools/ppops-payer` is a payer-side Gate A/Gate B harness. Its binary is built
   separately (`tools/ppops-payer/package.json:L20-L22`). It accepts a payer
   mnemonic only when first importing a full RAILGUN wallet. Gate A additionally
   loads an EVM self-signing key; Gate B sets `requireSelfSigner=false` and uses
   an owner-pinned Broadcaster trust file plus the Waku Broadcaster client
   (`tools/ppops-payer/src/cli.ts:L295-L320`, `L793-L857`). It does not run in the
   merchant daemon. An executable boundary check rejects merchant imports of
   payer code, payer imports that escape its package, merchant spending-material
   options, payer inclusion in the merchant build/package, and Docker copies of
   payer tooling (`scripts/trust-boundary-check.ts:L31-L89`).

The verification boundary mirrors the runtime boundary: root Vitest discovery
is limited to `test/**/*.test.ts` and root coverage to `src/**/*.ts`
(`vitest.config.ts:L3-L16`); payer tests/build/audit execute from the payer
package through its own `verify` script (`tools/ppops-payer/package.json:L23-L28`).
Root `verify:all` composes the two runs without merging their test discovery or
coverage accounting (`package.json:L41-L46`).
The latest separate verification reported by the coordinating run contained 19
merchant test files / 58 tests and 15 payer test files / 79 tests; those counts
are execution observations rather than source invariants.

The protocol path is:

```text
merchant backend
  -> authenticated PPOps API
  -> SQLite intent + opaque reference + signed descriptor
  -> public metadata-minimal request.json
  -> independently pinned merchant signer verification on payer host
  -> full RAILGUN payer wallet + encrypted memo + private ERC-20 proof
  -> Gate A: local EVM self-signer -> Arbitrum RAILGUN proxy transaction
     OR
  -> Gate B: pinned fee-signers -> validated quote -> encrypted Waku request
       -> initial reservation OR bounded same-request/payer/nullifier retry
       -> selected RAILGUN Broadcaster -> Arbitrum RAILGUN proxy transaction
       -> classified rejection/ambiguity OR reported hash
       -> payer nullifier-based canonical-hash recovery + RPC receipt quorum
  -> merchant view-only RAILGUN scan
  -> RPC-quorum finality + SDK/PPOI balance bucket
  -> transactional settlement/projection/outbox
  -> configured HMAC-authenticated webhook receiver
```

## Entry points

| Entry | Reachability | Authentication / authority | Durable effects |
| --- | --- | --- | --- |
| Root CLI `main` | Local process arguments (`src/cli.ts:L375-L590`) | OS user and access to config/secret files | Init secrets/config; start daemon; scan; backup/restore; gate evidence |
| `GET /v1/live`, `/v1/ready`, `/v1/health` | HTTP, wherever server is bound (`src/api/app.ts:L220-L252`) | None | None; returns process/scan state |
| `GET /pay/:id`, `/pay/:id/request.json` | HTTP (`src/api/app.ts:L200-L210`) | Possession/discovery of random intent ID; no Bearer token | None; returns payer-facing payment data, not `externalReference` |
| `/v1/*` operational routes | HTTP (`src/api/app.ts:L254-L467`) | Fixed-window source limit, 64 KiB body cap, Bearer token middleware (`L254-L282`) | Intent creation and outbox replay; other routes read state |
| Scheduled scan | Daemon timer (`src/api/server.ts:L101-L121`) | Process-internal | Settlement/projection/outbox writes and webhook delivery |
| `scan-once` | Root CLI (`src/cli.ts:L346-L354`) | OS user and local secrets | Same reconciliation effects as scheduled scan |
| Outbound webhook | Internal maintenance (`src/runtime.ts:L129-L143`) | HMAC key establishes message origin for receiver | External HTTP side effect; local delivery/retry/dead-letter state |
| Payer CLI `main` | Local process arguments (`tools/ppops-payer/src/cli.ts:L1037-L1125`) | OS user, owner-only config/secrets, explicit command bounds | Full-wallet import/cache, sync state, journal transitions, Gate A submission, or Gate B submission/retry/recovery |
| Payer `pay-broadcaster` / `retry-broadcaster` | Local CLI command (`tools/ppops-payer/src/cli.ts:L793-L905`) | Independently supplied merchant signer, payer address, amount/fee ceilings and exact intent confirmation; retry additionally requires an eligible local lineage | Proof/cache activity, initial or retry journal reservation, Waku message and possibly Arbitrum transaction/receipt state |
| Payer `recover-broadcaster` | Local CLI command (`tools/ppops-payer/src/cli.ts:L907-L1035`) | Expected payer address plus existing Broadcaster journal record and full payer wallet for nonterminal lookup | Reports `REJECTED`; may advance `SUBMITTING` to `SUBMITTED`, then `MINED` or `REVERTED`; reports same-nullifier retry availability without sending |
| Payer `submission-status` | Local process arguments (`tools/ppops-payer/src/cli.ts:L564-L613`) | OS user and owner-only payer config/journal | None; reports base state including `REJECTED`, retry count, rejection/ambiguity categories, reported/canonical hashes and block when present |
| Payer request loader | HTTPS or loopback HTTP, or local file (`tools/ppops-payer/src/request.ts:L134-L164`) | Descriptor must later verify against signer supplied out of band; value-bearing Gate A/B require a live URL | None until a submission path proceeds |

All root routes registered after the authentication middleware at
`src/api/app.ts:L272-L282` are authenticated. The three health routes and the
two checkout routes are registered before it and are therefore intentionally
unauthenticated. Static payer assets are also unauthenticated
(`src/api/app.ts:L188-L198`).

## Persistent state

### Merchant side

- SQLite holds local commercial references, opaque payment references, signed
  descriptors, projections, normalized settlements, idempotency records, and
  the event outbox (`src/db/database.ts:L156-L247`). WAL, foreign keys, and
  `synchronous=FULL` are enabled (`src/db/database.ts:L138-L145`).
- RAILGUN LevelDOWN holds encrypted wallet/scan state; a separate owner-only
  JSON file binds wallet ID, 0zk address, and viewing-key fingerprint
  (`src/railgun/engine.ts:L304-L347`).
- Files hold API, merchant signer, RAILGUN DB-encryption, viewing, and optional
  webhook keys. Config, wallet state, and secrets pass regular-file, no-symlink,
  size, owner, and no-group/other-access checks on non-Windows systems
  (`src/security/private-file.ts:L9-L58`; `src/security/secrets.ts:L27-L57`).
- The runtime lock is a separate file keyed by PID and random token
  (`src/security/runtime-lock.ts:L38-L66`).
- Backups can hold merchant state alone or, by an explicit flag, state plus the
  service/viewing secrets (`src/backup.ts:L127-L216`).

### Payer side

- A separate LevelDOWN and owner-only wallet-state JSON hold the full RAILGUN
  wallet cache and its creation block (`tools/ppops-payer/src/railgun/engine.ts:L386-L424`).
- The mnemonic is read only when the wallet-state file does not exist; the EVM
  private key is read only when a Gate A command sets `requireSelfSigner=true`;
  Gate B loads neither key after initial wallet import
  (`tools/ppops-payer/src/cli.ts:L295-L320`, `L705-L790`, `L793-L857`).
- The payer config, DB key, mnemonic, and EVM key are resolved relative to the
  payer config and required to occupy distinct paths
  (`tools/ppops-payer/src/config.ts:L87-L137`).
- There is no shared database or direct import boundary between the merchant
  and payer packages. Their deliberate coupling is the request JSON and signed
  descriptor format.
- Payer CLI engine operations acquire a PID/token lock derived from the
  wallet-state path before engine construction and release it after shutdown
  (`tools/ppops-payer/src/cli.ts:L655-L692`;
  `tools/ppops-payer/src/security/runtime-lock.ts:L38-L78`).
- A JSON submission journal adjacent to wallet state distinguishes
  `SELF_SIGNED` and `BROADCASTER` records. Gate B base state is
  `SUBMITTING -> SUBMITTED -> MINED|REVERTED` or fresh
  `SUBMITTING -> REJECTED`; up to three same-request/payer/nullifier retry
  attempts carry their own `RESERVED|REJECTED|AMBIGUOUS|REPORTED` outcome. The
  Waku-reported hash remains separate until wallet nullifier lookup supplies a
  canonical hash
  (`tools/ppops-payer/src/security/submission-journal.ts:L19-L246`,
  `L305-L702`).
- Broadcaster journal reads/writes remain owner-only, schema-validated
  whole-document replacements with file and non-Windows directory sync
  (`tools/ppops-payer/src/security/submission-journal.ts:L704-L747`).

## Trust boundaries and external dependencies

| Boundary | Data crossing | Code-side establishment |
| --- | --- | --- |
| Merchant backend -> PPOps API | Intent metadata and idempotency key | Schema validation at `src/api/app.ts:L20-L35`; Bearer middleware at `L272-L282`; creation at `L294-L321` |
| PPOps checkout -> payer | Chain/token/amount, recipient, memo, descriptor | Minimal checkout projection at `src/api/app.ts:L65-L82`; payer verifies all duplicated fields at `tools/ppops-payer/src/request.ts:L51-L93` |
| Trusted merchant identity -> payer | Expected EVM signer | Supplied separately as CLI input at `tools/ppops-payer/src/cli.ts:L286-L296`; signature comparison at `tools/ppops-payer/src/descriptor.ts:L54-L73` |
| Merchant host -> local filesystem | Config, secrets, SQLite, LevelDB, artifacts | Owner/file/type/size/identity checks at `src/security/private-file.ts:L9-L58`; schema/path checks; OS filesystem remains part of the trusted base |
| Payer host -> local filesystem | Mnemonic, full-wallet cache, EVM key | Owner/file/type/size/identity checks at `tools/ppops-payer/src/security/private-file.ts:L9-L58` |
| Both processes -> RAILGUN Wallet SDK | Viewing key or mnemonic, wallet DB key, notes, proofs, balances, PPOI buckets | Pinned package versions at root `package.json:L58-L67` and payer `tools/ppops-payer/package.json:L33-L41`; cryptographic/protocol behavior remains dependency behavior |
| Scanner -> RPC providers | Chain ID, latest/finalized heights, receipts, blocks | Majority grouping/height clustering in `src/railgun/rpc-quorum.ts:L68-L175` |
| Wallet SDK -> PPOI nodes | PPOI health/proof/bucket data | URL/profile constraints at `src/config.ts:L144-L221`; health preflight at `src/railgun/ppoi-preflight.ts:L18-L68`; proof semantics remain an SDK/PPOI dependency |
| Payer -> one submission RPC | Network/fee reads and raw transaction submission | First healthy provider selection with chain-ID check at `tools/ppops-payer/src/railgun/self-signed-transfer.ts:L49-L75` |
| Payer -> configured simulation RPCs | Exact validated post-proof Broadcaster target/calldata | Bounded strict-majority `eth_estimateGas` and upper-median selection before Waku/journal effects at `tools/ppops-payer/src/railgun/rpc-quorum.ts` and `tools/ppops-payer/src/railgun/broadcaster-transfer.ts` |
| Operator trust file -> Waku fee cache | One to sixteen trusted fee-signer 0zk addresses, Waku topic, time/reliability/version bounds | Owner-only strict trust config at `tools/ppops-payer/src/broadcaster/config.ts:L37-L104`; passed to the SDK at `tools/ppops-payer/src/broadcaster/session.ts:L262-L290`; local SDK verifies broadcaster fee-message signatures and applies trusted-signer fee authorization at `tools/ppops-payer/node_modules/@railgun-community/waku-broadcaster-client-node/dist/fees/handle-fees-message.js:L32-L128` |
| Payer -> Waku/Broadcaster | RAILGUN proxy target/calldata, fee ID, gas floor and pre-transaction PPOI payload encrypted to selected Broadcaster viewing key; retry excludes every previously attempted Broadcaster identity and preserves the exact original nullifier set | Retry selection at `tools/ppops-payer/src/railgun/broadcaster-transfer.ts:L138-L178` and `tools/ppops-payer/src/broadcaster/session.ts:L196-L260`; `prepareSubmission` at `tools/ppops-payer/src/broadcaster/session.ts:L445-L478`; retry binding at `tools/ppops-payer/src/security/submission-journal.ts:L412-L468`; pinned local client encryption at `tools/ppops-payer/node_modules/@railgun-community/waku-broadcaster-client-node/dist/transact/broadcaster-transaction.js:L41-L68` |
| Waku/Broadcaster -> payer | Encrypted transact response text or completion inferred from the reserved nullifiers | SDK response-key state/decryption at `tools/ppops-payer/node_modules/@railgun-community/waku-broadcaster-client-node/dist/transact/broadcaster-transact-response.js:L5-L44`; exact response classifiers plus unclassified fallback at `tools/ppops-payer/src/broadcaster/failures.ts:L39-L165` and `tools/ppops-payer/src/broadcaster/session.ts:L480-L517`; reported/canonical split at `tools/ppops-payer/src/railgun/broadcaster-transfer.ts:L357-L448` |
| Payer wallet state -> canonical public hash | One to 64 populated transfer nullifiers | Project wrapper at `tools/ppops-payer/src/railgun/engine.ts:L253-L274`; installed Wallet/Engine path requires every nullifier to map to the same transaction in one UTXO tree at `tools/ppops-payer/node_modules/@railgun-community/engine/dist/railgun-engine.js:L1255-L1275` |
| Payer -> configured receipt RPCs | Canonical transaction hash | Strict identical-receipt majority at `tools/ppops-payer/src/railgun/rpc-quorum.ts:L121-L185` |
| PPOps -> webhook receiver | Stored event JSON plus timestamp/key ID/event ID/HMAC | Signature construction and redirect/timeout policy at `src/events/webhook.ts:L93-L149` |
| Operator -> backup input | Manifest and files, optionally secrets | Schema, exact inventory and SHA-256 checks at `src/backup.ts:L25-L53` and `L219-L235`; manifest is not independently authenticated by this code |

## Assets

### Confidentiality-sensitive

- Merchant RAILGUN viewing key and decrypted receiver transaction history.
- Merchant SQLite mapping from opaque references to `externalReference`.
- Merchant EIP-712 private key, API token, RAILGUN database-encryption key, and
  webhook HMAC key.
- RPC URLs when provider identifiers/secrets are carried in their path or query;
  URL username/password fields are forbidden (`src/config.ts:L23-L31`).
- Payer mnemonic, payer RAILGUN wallet database key, full wallet cache, and
  EVM self-signing private key.
- Gate B transaction nullifiers, payer/Broadcaster 0zk identities, Waku response
  key held by the local SDK, retry attempt metadata, and the operator-pinned
  Broadcaster trust file.
- Backups made with `includeSecrets: true`.

### Integrity/availability-sensitive

- Independently distributed merchant signer address.
- Intent descriptor fields and the exact memo/reference binding.
- Stable settlement identity and immutable identity fields.
- Chain finality and PPOI-derived spendability classification.
- Projection totals/status/revision and event dedupe keys.
- Webhook delivery/dead-letter state.
- Wallet creation block and persisted wallet identity on the payer.
- Explicit payer address, self-signer address, amount cap, and gas-cost cap.
- Gate B trusted fee-signer set, exact/compatible quote identity, fee ceiling,
  active cross-record nullifier ownership, retry lineage, stable rejection/
  ambiguity categories, reported hash, canonical hash, and receipt state.

### Financial authority

- Root PPOps has no RAILGUN spending credential in its configuration schema
  (`src/config.ts:L82-L88`) and checks that the loaded wallet cannot be resolved
  or used as a full/signing wallet (`src/railgun/engine.ts:L227-L246`).
- `tools/ppops-payer` intentionally has spending authority: it imports a mnemonic
  (`tools/ppops-payer/src/railgun/engine.ts:L405-L408`). Gate A sends through an
  EVM signer; Gate B creates a private transfer proof with a token fee payable to
  the selected Broadcaster, then sends the encrypted request through Waku without
  loading the optional EVM self-signing key
  (`tools/ppops-payer/src/railgun/broadcaster-transfer.ts:L156-L266`, `L324-L359`;
  `tools/ppops-payer/src/cli.ts:L817-L857`).

## Cross-component invariants

1. **Trust-domain separation.** Root `src/` must not import payer code or accept
   payer mnemonic/spending material. The payer remains a separate package and
   process even though it is in the same Git repository. Current code
   establishes this through separate manifests/binaries, the root secret schema,
   and an executable import/build/Docker boundary check
   (`scripts/trust-boundary-check.ts:L31-L80`). No runtime enforcement of “never
   install payer tooling on the merchant host” was found because that remains an
   operator/deployment property.
2. **Descriptor trust root is external.** A descriptor is acceptable only when
   both embedded and recovered signers equal an independently supplied address
   (`src/security/descriptor.ts:L95-L111` and
   `tools/ppops-payer/src/descriptor.ts:L54-L73`). The checkout's own
   `expectedMerchantSigner` is cross-checked but is not the root of trust
   (`tools/ppops-payer/src/request.ts:L89-L92`).
3. **Payment request exactness.** The payer requires an open, unreceived,
   unexpired Arbitrum/native-USDC request, then compares chain, token, decimals,
   amount, recipient, and memo to the signed descriptor
   (`tools/ppops-payer/src/request.ts:L59-L92`).
4. **Opaque correlation.** Only memos matching the complete
   `ppops:v1:0x<32 bytes>` grammar yield a reference
   (`src/domain.ts:L110-L120`); the scanner persists the parsed reference, not
   free-form memo text (`src/railgun/scanner.ts:L128-L140`, `L168-L213`).
5. **Stable settlement identity.** Identity is
   `chainId:txidVersion:transactionHash:tree:position`
   (`src/railgun/scanner.ts:L188-L203`). Rediscovery requires chain, version,
   coordinates, transaction hash, token, amount, and reference to remain equal
   (`src/reconciliation/service.ts:L12-L21`, `L155-L167`).
6. **Credit eligibility is conjunctive.** Only `MATCHED + FINALIZED + SPENDABLE`
   value contributes to received amount (`src/reconciliation/projection.ts:L8-L19`,
   `L50-L77`). Pending matched value remains separate.
7. **Intent state is derived.** Projection amounts/status are recalculated from
   all settlements, using `bigint`, and the revision changes only when the
   observable projection changes (`src/reconciliation/projection.ts:L50-L77`).
8. **Atomic state and event creation.** Settlement upsert, projection rebuild,
   revision update, and event insertion occur inside one SQLite transaction
   (`src/reconciliation/service.ts:L44-L91`). Intent and idempotency mapping are
   likewise inserted transactionally (`src/intents/service.ts:L137-L157`).
9. **Outbox deduplication.** Dedupe keys are unique in SQLite
   (`src/db/database.ts:L217-L239`), event IDs are deterministic from the dedupe
   key (`src/events/event-factory.ts:L10-L30`), and only successful HTTP marks an
   event delivered (`src/events/webhook.ts:L93-L149`). This is an at-least-once
   delivery model from the receiver's perspective because a process can stop
   after the receiver accepts but before local delivery is marked.
10. **Merchant process exclusivity.** One runtime lock is acquired before the
    LevelDB/SQLite are opened (`src/runtime.ts:L53-L60`) and is released last on
    shutdown (`src/runtime.ts:L146-L171`). Backup/restore first require the
    runtime to be stopped (`src/backup.ts:L127-L135`, `L243-L251`).
11. **Payer process exclusivity.** Normal `sync`, Gate A, Gate B, POI and
    nullifier-recovery engine operations use `withEngine`, which acquires a
    PID/token lock before engine construction and releases it after shutdown
    (`tools/ppops-payer/src/cli.ts:L655-L692`, `L831-L857`, `L959-L966`).
12. **Payer execution is explicitly bounded.** The CLI requires exact intent ID,
    amount cap, expected payer 0zk address, expected EVM signer, and gas-cost cap
    before calling the spend path (`tools/ppops-payer/src/cli.ts:L375-L409`). The
    populated transaction must target the configured RAILGUN proxy and carry
    zero ETH (`tools/ppops-payer/src/railgun/self-signed-transfer.ts:L198-L230`).
13. **Bounded CLI failure output.** Root command failures are classified into a
    fixed code (`src/security/failures.ts:L1-L65`) at the final CLI boundary
    (`src/cli.ts:L592-L604`). Payer runtime errors are likewise reduced to a
    fixed code (`tools/ppops-payer/src/events.ts:L21-L66`) at the final promise
    rejection boundary (`tools/ppops-payer/src/cli.ts:L1116-L1125`); payer events
    contain selected SDK status/progress fields rather than caught error text.
    This relies on command failures reaching the respective final boundaries.
14. **One local payer lineage per intent.** Gate A and a fresh Gate B operation
    refuse an existing intent record. Gate A reserves a precomputed public hash
    before its network call; Gate B reserves payer/quote/fee/nullifiers before
    Waku. The dedicated retry path mutates that same record only when request,
    payer and exact nullifier set match, no hash is known/reported, and fewer
    than three retry attempts exist
    (`tools/ppops-payer/src/railgun/self-signed-transfer.ts:L195-L196`,
    `L372-L391`; `tools/ppops-payer/src/railgun/broadcaster-transfer.ts:L132-L154`,
    `L337-L355`; `tools/ppops-payer/src/security/submission-journal.ts:L305-L468`).
15. **Verification results preserve package ownership.** Merchant test discovery
    and coverage include only root `test/` and `src/`; payer verification runs
    separately from `tools/ppops-payer`. `verify:all` requires both package
    pipelines (`vitest.config.ts:L3-L16`; `package.json:L41-L46`;
    `tools/ppops-payer/package.json:L23-L28`).
16. **Gate B financial bounds precede proof submission.** The CLI independently
    bounds payment amount and confirms the exact intent; the transfer path
    validates a positive uint256 fee ceiling, a quorum-derived Arbitrum gas
    price, quote token/identity/lifetime/reliability, the exact calculated token
    fee, and `payment + fee` spendable balance before Waku submission
    (`tools/ppops-payer/src/cli.ts:L793-L853`;
    `tools/ppops-payer/src/railgun/broadcaster-transfer.ts:L120-L244`).
17. **Gate B preparation is separated from the irreversible call.** Proof and
    population complete, the proxy/zero-value/nullifier set is checked, active
    cross-intent reservations are rejected without mutation, and a configured
    RPC majority simulates the exact final calldata. The live request and quote
    are then revalidated, and `submit=false` returns without constructing a Waku
    transaction or journal record. On `submit=true`, local encrypted-message
    construction completes before the journal reservation; `submitPrepared` is
    called only after that reservation returns
    (`tools/ppops-payer/src/railgun/broadcaster-transfer.ts`).
18. **Canonical Gate B identity comes from nullifiers.** The hash returned by
    the Waku client is journaled only as `reportedTransactionHash`. Wallet/engine
    lookup requires all reserved nullifiers to map to one transaction; only that
    result can populate `transactionHash`, drive receipt quorum, and advance the
    journal (`tools/ppops-payer/src/railgun/broadcaster-transfer.ts:L407-L470`;
    `tools/ppops-payer/node_modules/@railgun-community/engine/dist/railgun-engine.js:L1255-L1275`).
19. **Gate B state distinguishes rejection, ambiguity and chain progress.**
    Base records accept `SUBMITTING -> SUBMITTED -> MINED|REVERTED` or a fresh
    hashless `SUBMITTING -> REJECTED`. Retry attempts independently move from
    `RESERVED` to `REJECTED`, `AMBIGUOUS`, or `REPORTED`, while ambiguity/retry
    rejection preserves base `SUBMITTING`. Canonical hash/block presence is
    coupled to base status
    (`tools/ppops-payer/src/security/submission-journal.ts:L19-L246`,
    `L470-L702`).
20. **Active nullifier ownership is checked before a fresh Gate B reserve.** A
    populated/journaled set contains one to 64 nonzero unique 32-byte values
    (`tools/ppops-payer/src/railgun/populated-transfer.ts:L10-L27`;
    `tools/ppops-payer/src/security/submission-journal.ts:L170-L182`). A new
    reservation rejects overlap with any other Broadcaster record in
    `SUBMITTING`, `SUBMITTED`, or `MINED`; `REJECTED` and `REVERTED` are excluded.
    Retry requires exact equality with its own original set
    (`tools/ppops-payer/src/security/submission-journal.ts:L362-L468`).
21. **One SDK Broadcaster transaction is active in the normal CLI process.** A
    payer runtime lock spans Gate B proof, `BroadcasterSession`, Waku send and
    immediate canonical recovery (`tools/ppops-payer/src/cli.ts:L831-L857`). The
    pinned Waku client stores one process-global response shared key and one
    stored transaction response (`tools/ppops-payer/node_modules/@railgun-community/waku-broadcaster-client-node/dist/transact/broadcaster-transact-response.js:L5-L15`).
22. **Broadcaster response categories are exact and bounded.** Remote response
    categories require the installed SDK's expected outer error plus an exact
    nested message-map hit. The exact local SDK timeout and an invalid returned
    hash have their own ambiguity categories. A fresh classified rejection
    becomes `REJECTED`; every ambiguity remains `SUBMITTING`; every otherwise
    unrecognized post-send error becomes the stable `UNCLASSIFIED_FAILURE`
    ambiguity
    (`tools/ppops-payer/src/broadcaster/failures.ts:L39-L165`;
    `tools/ppops-payer/src/broadcaster/session.ts:L480-L517`;
    `tools/ppops-payer/src/railgun/broadcaster-transfer.ts:L357-L406`).
23. **Standard retries diversify Broadcaster identity.** The retry path derives
    an exclusion list from the original Broadcaster plus every prior retry
    attempt. Discovery validates all current quotes, removes those identities,
    then sorts eligible quotes by lowest fee-per-gas, highest reliability and
    fingerprint; a retry cannot proceed to proof until an alternate identity is
    selected (`tools/ppops-payer/src/railgun/broadcaster-transfer.ts:L138-L178`;
    `tools/ppops-payer/src/broadcaster/session.ts:L196-L260`, `L341-L398`).

## Assumptions recorded as `nothing found`

These are inputs the current code relies on; they are not conclusions about
impact.

- **Independent operator inputs:** descriptor verification and payer execution
  assume the expected merchant signer, payer address, self-signer, amount cap,
  gas cap, and intent confirmation were obtained/chosen independently of the
  untrusted request. Their provenance is established by: **nothing found** in
  application code.
- **HTTP source identity:** public-route limiting assumes `requestSource` maps a
  request to a useful source identity even though it can fall back to `unknown`
  (`src/api/app.ts:L140-L146`). Proxy/source establishment is provided by:
  **nothing found** inside `createApp`.
- **Digest equality as identity:** intent idempotency and wallet/request
  fingerprints assume equality of their SHA-256 digests is sufficient; special
  collision handling is established by: **nothing found**.
- **Payer lock participation by library callers:** normal CLI engine operations
  acquire `PayerRuntimeLock`, but `PayerRailgunEngine` is exported and does not
  acquire the lock internally. A guarantee that every non-CLI consumer uses the
  wrapper is established by: **nothing found** at the module boundary.
- **Gate B operator trust provenance:** `pay-broadcaster` and
  `retry-broadcaster` assume the merchant
  signer, expected payer address, amount/fee ceilings, exact intent confirmation,
  and Broadcaster trusted fee-signer set came from independently authenticated
  operator decisions (`tools/ppops-payer/src/cli.ts:L793-L853`). Their provenance
  is established by: **nothing found** in application code.
- **One active Waku transaction per process:** `BroadcasterTransaction.create`
  replaces one static response shared key and clears one static stored response
  (`tools/ppops-payer/node_modules/@railgun-community/waku-broadcaster-client-node/dist/transact/broadcaster-transact-response.js:L5-L15`).
  The standard CLI places one Gate B operation under one runtime lock, but a
  guarantee that exported `BroadcasterSession` callers never overlap prepared
  submissions is established by: **nothing found** at the class boundary.
- **Compatible fee-ID rotation:** a fresh quote may replace the proof-time quote
  when Broadcaster address, token and fee-per-gas remain equal
  (`tools/ppops-payer/src/broadcaster/session.ts:L150-L194`, `L414-L439`). The
  assumption that the selected Broadcaster will accept the successor fee ID and
  that this substitution preserves all protocol-bound economics is established
  by: **nothing found in project source** beyond identical recipient/token/rate;
  it is a Broadcaster protocol/SDK contract.
- **Waku delivery/response contract:** the installed client retries the encrypted
  request, queries historical responses, decrypts through the static shared key,
  and can alternatively return a nullifier-derived txid
  (`tools/ppops-payer/node_modules/@railgun-community/waku-broadcaster-client-node/dist/transact/broadcaster-transaction.js:L69-L145`).
  A guarantee that LightPush acceptance, Store/Filter retrieval and decrypted
  response identity represent one selected Broadcaster is established by:
  **nothing found** in PPOps source; these are SDK/Waku dependencies.
- **Pre-transaction PPOI and encrypted payload binding:** Gate B passes proxy
  calldata, fee ID, gas floor, nullifiers and pre-transaction PPOI data to the
  pinned client's `BroadcasterTransaction.create`
  (`tools/ppops-payer/src/broadcaster/session.ts:L445-L470`). The cryptographic
  binding and Broadcaster-side interpretation are established by: **nothing
  found in project source**; the local installed SDK delegates encryption to the
  Wallet package at
  `tools/ppops-payer/node_modules/@railgun-community/waku-broadcaster-client-node/dist/transact/broadcaster-transaction.js:L45-L67`.
- **Nullifier-to-canonical-hash identity:** Wallet/Engine lookup accepts a hash
  only when every supplied nullifier resolves to the same txid in one tree
  (`tools/ppops-payer/node_modules/@railgun-community/engine/dist/railgun-engine.js:L1255-L1275`).
  The protocol guarantee that this lookup result is the canonical Arbitrum
  transaction intended by the populated proof is established by: **nothing
  found in PPOps source**; it is a Wallet/Engine state dependency.
- **Journal-wide identity from method provenance:** `reserveBroadcaster` rejects
  active cross-record nullifier overlap and duplicate intent ID, while retry
  requires its own exact original set
  (`tools/ppops-payer/src/security/submission-journal.ts:L362-L468`). The
  whole-file schema itself does not enforce unique intent IDs or cross-record
  nullifier ownership; a guarantee that all preexisting state was constructed
  through serialized public methods is established by: **nothing found** in the
  schema.
- **Nullifier reuse after terminal rejection/revert:** a fresh reservation ignores
  overlaps owned by `REJECTED` or `REVERTED` records
  (`tools/ppops-payer/src/security/submission-journal.ts:L381-L394`). The protocol
  guarantee that these outcomes make the same notes available for a different
  intent is established by: **nothing found** in project source.
- **Same-nullifier retry contract:** retry regenerates proof/population and may
  select refreshed Broadcaster/quote/fee metadata, but the journal requires the
  exact original request, payer and nullifier set and caps attempts at three
  (`tools/ppops-payer/src/railgun/broadcaster-transfer.ts:L324-L355`;
  `tools/ppops-payer/src/security/submission-journal.ts:L412-L468`). Remote
  idempotence and proof-identity semantics are established by: **nothing found**
  in project source.
- **Broadcaster identity diversity:** standard retry excludes the original and
  prior-attempt 0zk addresses before deterministic quote selection
  (`tools/ppops-payer/src/railgun/broadcaster-transfer.ts:L138-L178`;
  `tools/ppops-payer/src/broadcaster/session.ts:L196-L260`). The guarantee that
  distinct 0zk identities represent operationally independent Broadcasters is
  established by: **nothing found** in project source.
- **Broadcaster response-category contract:** remote rejection/ambiguity mapping
  requires exact installed-SDK outer and nested error strings; the exact local
  timeout and invalid returned hash have explicit ambiguity enums, and every
  otherwise unmatched post-send error becomes `UNCLASSIFIED_FAILURE`
  (`tools/ppops-payer/src/broadcaster/failures.ts:L39-L137`;
  `tools/ppops-payer/src/broadcaster/session.ts:L480-L517`). The stability and
  remote non-submission/uncertainty meaning of those strings across accepted
  Broadcaster versions is established by: **nothing found** in project source.
- **Recovery journal serialization:** `recoverBroadcaster` reads the record
  before `withEngine`, and its `markSubmitted`/`markMined` calls occur after
  `withEngine` returns and releases the runtime lock
  (`tools/ppops-payer/src/cli.ts:L914-L966`, `L985-L1018`;
  `tools/ppops-payer/src/cli.ts:L655-L692`). An independent lock inside
  `SubmissionJournal` or a guarantee that no other writer overlaps those calls
  is established by: **nothing found**.
- **Safe failure code runtime membership:** `safeFailureResult` emits the `code`
  property of any object that is an instance of exported `SafeFailure`; the union
  is enforced by TypeScript callers but not revalidated at serialization time
  (`tools/ppops-payer/src/events.ts:L21-L66`). A runtime membership check for
  direct JavaScript consumers is established by: **nothing found**.
- **Merchant intent state through submission:** `paySelfSigned` verifies `OPEN`
  and zero received/pending before engine start/sync/proof, while the transfer
  path separately rechecks local expiry immediately before reservation and send
  (`tools/ppops-payer/src/cli.ts:L386-L400`;
  `tools/ppops-payer/src/railgun/self-signed-transfer.ts:L241-L244`). It assumes
  the merchant's live status and received/pending amounts have not changed.
  Established by: **nothing found**; the request is not fetched again after the
  potentially long operations.
- **Single payer spend actor:** the pre-proof `Spendable` balance check assumes
  another wallet/process does not consume the same notes before proof/submission
  (`tools/ppops-payer/src/railgun/self-signed-transfer.ts:L108-L114`). Established
  by: **nothing found** in this repository.
- **Payer submission provider account of chain state:** `selectProvider` verifies
  chain ID and fee availability but the chosen RPC is not compared with another
  provider for fee, balance, nonce, or submission result
  (`tools/ppops-payer/src/railgun/self-signed-transfer.ts:L49-L75`, `L177-L183`,
  `L232-L239`). An independent-provider guarantee is established by:
  **nothing found** on this send path.
- **SDK proof/population contract:** project code assumes RAILGUN's pinned SDK
  binds the generated proof to the passed TXID version, wallet, memo, recipients,
  and gas details (`tools/ppops-payer/src/railgun/self-signed-transfer.ts:L121-L203`).
  Established by: **nothing found in project source**; the dependency is treated
  as an external black box in this context pass.
- **SDK view-only TXO interpretation:** the reconciler assumes Wallet SDK TXOs,
  `POI.getBalanceBucket`, and `txo.txid/tree/position` represent the receiver note
  and PPOI state as consumed (`src/railgun/scanner.ts:L118-L140`, `L168-L213`).
  Established by: **nothing found in project source**; this is a pinned SDK/PPOI
  dependency.
- **SDK lifecycle signals and authority probes:** both scanners assume the SDK's
  refresh/scan promises make TXO and PPOI buckets ready; the merchant additionally
  identifies view-only authority through the pinned SDK's full-wallet/signing
  lookup failure behavior. Further establishment is provided by: **nothing found
  in project source**.
- **Historical spendability transition:** reconciliation preserves prior
  `SPENDABLE` credit when a later raw PPOI state is `Valid` and the note is
  `Spent` (`src/reconciliation/service.ts:L58-L63`). The protocol-level semantic
  guarantee is established by: **nothing found in project source**.
- **Direct reconciliation callers and revision lifetime:** scanner callers
  supply numeric strings and known enum states, but `reconcile` does not
  runtime-validate those direct inputs, and projection revision assumes it stays
  a safe integer over system lifetime. Additional bounds are established by:
  **nothing found** at those function boundaries.
- **Recipient ownership:** intent creation signs the receiver 0zk address loaded
  by the view-only engine (`src/runtime.ts:L58-L66`), but ownership/merchant
  control of the corresponding spending wallet is not proven by PPOps.
  Established by: **nothing found**; receiver spending authority is explicitly
  outside the reconciler.
- **Remote TLS and host environment:** non-loopback webhook/PPOI/request URLs are
  required to use HTTPS, but endpoint identity, DNS, CA roots, local OS account
  integrity, and filesystem confidentiality are assumed. Established by:
  **nothing found in application code** beyond URL-scheme and owner-only
  regular-file/identity checks. On Windows, equivalent ACL enforcement is also
  established by: **nothing found** in the private-file helpers.
- **Backup provenance:** restore verifies schema, exact inventory, hashes,
  network/token, and secret identity (`src/backup.ts:L219-L287`), but assumes the
  backup root itself comes from the intended operator. An authenticated backup
  signer is established by: **nothing found**.
- **One-threaded webhook delivery:** delivery reads pending events then marks
  them after the network response (`src/events/webhook.ts:L93-L149`). The daemon
  schedules maintenance serially, but an exclusivity primitive inside
  `deliverPending` itself is established by: **nothing found**; callers are
  expected not to overlap it.
- **Submission-journal filesystem contract on Windows:** journal replacement
  syncs the file and, on non-Windows systems, its directory after rename
  (`tools/ppops-payer/src/security/submission-journal.ts:L720-L740`). An
  equivalent explicit directory-sync step on Windows is established by:
  **nothing found** in the journal writer.

## Open questions carried forward

1. What deployment mechanism will enforce that the merchant service image does
   not include or execute the payer package, despite sharing a repository?
2. What independently trusted channel will distribute and rotate the merchant
   signer address to payers?
3. Is payer `walletCreationBlock` guaranteed to be at or before every note the
   restored wallet must discover, and where is that provenance recorded?
4. Which parties may operate the configured RPC and PPOI endpoints? The code
   validates agreement/health, not organizational independence.
5. What precise semantics does the pinned Wallet SDK assign to `Spent` plus raw
   `Valid` PPOI state across supported TXID versions? The reconciler preserves
   prior spendability for a specific transition (`src/reconciliation/service.ts:L58-L63`).
6. Can the RAILGUN SDK return a TXO whose public transaction receipt is not yet
   available? Current normalization maps a missing/non-success receipt to
   `REVERTED` (`src/railgun/scanner.ts:L176-L213`). This pass did not inspect SDK
   timing guarantees.
7. Is a successful `sendTransaction` response sufficient evidence for Gate A,
   or must the payer harness itself later wait for and verify a receipt? The
   current return guarantee ends at transaction-hash submission
   (`tools/ppops-payer/src/railgun/self-signed-transfer.ts:L232-L239`).
8. What is the intended operator response to an ambiguous payer submission
   failure? The journal deliberately leaves a pre-send reservation in
   `SUBMITTING` when submission or subsequent journal update does not complete
   (`tools/ppops-payer/src/railgun/self-signed-transfer.ts:L241-L255`), but the
   operational interpretation/reconciliation procedure is not encoded here.
9. Should recovery encompass payer LevelDB/wallet-state, or is the mnemonic plus
   creation block the canonical payer recovery mechanism? Root backup/restore
   covers merchant state only.
10. Windows skips Unix mode/UID checks in the merchant and payer private-file
    helpers (`src/security/private-file.ts:L20-L29` and the mirrored payer
    helper). The equivalent Windows
    access-control precondition is not described in source.
11. Does the pinned Waku client support more than one prepared/in-flight
    `BroadcasterTransaction` in a process? Its response decryptor holds one static
    shared key and response slot
    (`tools/ppops-payer/node_modules/@railgun-community/waku-broadcaster-client-node/dist/transact/broadcaster-transact-response.js:L5-L15`).
12. When `BroadcasterTransaction.send()` returns a hash, was it obtained from a
    decrypted Broadcaster response or from the client's own nullifier lookup?
    Both paths return the same untagged string
    (`tools/ppops-payer/node_modules/@railgun-community/waku-broadcaster-client-node/dist/transact/broadcaster-transaction.js:L82-L93`, `L127-L145`).
13. What external protocol guarantee says a Broadcaster retains or accepts a
    proof-compatible successor `feesID` when address, token and fee rate remain
    fixed (`tools/ppops-payer/src/broadcaster/session.ts:L150-L194`)?
14. What RAILGUN state guarantee makes nullifiers owned by `REJECTED` or
    `REVERTED` records eligible for a fresh intent while active-state collisions
    remain refused
    (`tools/ppops-payer/src/security/submission-journal.ts:L362-L410`)?
15. What operator evidence resolves a `SUBMITTING` Broadcaster record if repeated
    wallet syncs continue to return no canonical hash? Recovery reports
    `paymentRetryPermitted:false` and separately derives
    `sameNullifierRetryAvailable`
    (`tools/ppops-payer/src/cli.ts:L967-L983`).
16. Is `MINED` intended to mean receipt-quorum observation or chain finality?
    Gate B advances on an identical configured-provider receipt without a later
    finalized-height check (`tools/ppops-payer/src/railgun/rpc-quorum.ts:L121-L185`;
    `tools/ppops-payer/src/security/submission-journal.ts:L650-L674`).
17. What concurrency policy covers `recoverBroadcaster` journal updates after
    the engine wrapper has released `PayerRuntimeLock`
    (`tools/ppops-payer/src/cli.ts:L959-L1018`)?
18. On SDK timeout, does process shutdown or a later session clear the static
    response shared key? The installed `broadcast` timeout path throws before
    `clearSharedKey`, while success and explicit response-error paths clear it
    (`tools/ppops-payer/node_modules/@railgun-community/waku-broadcaster-client-node/dist/transact/broadcaster-transaction.js:L124-L144`).
19. Where is the versioned remote contract that assigns non-submission or
    chain-uncertainty meaning to each exact response string in the rejection and
    ambiguity maps (`tools/ppops-payer/src/broadcaster/failures.ts:L39-L137`)?
20. Does regenerating a proof with the same request, payer and exact nullifier
    set but a refreshed Broadcaster/quote/fee represent the same idempotent spend
    for every accepted Broadcaster version
    (`tools/ppops-payer/src/security/submission-journal.ts:L412-L468`)?
21. Is unique intent/active-nullifier ownership intended to be a schema property,
    or does recovery assume every journal snapshot was constructed only through
    serialized public methods?

## Operator-reported Gate B observation

One controlled run reported on 2026-08-30 exercised the current retry path. This
is an operational observation, not a source-code guarantee and not a review of
ignored runtime files:

- discovery reported 18 valid quotes representing 14 unique Broadcaster 0zk
  identities;
- the previously attempted identity was excluded and an alternate identity was
  selected before proof generation;
- proof generation completed, then the post-send path produced
  `UNCLASSIFIED_FAILURE` without a reported or canonical transaction hash;
- the durable lineage reached three retry attempts, so the configured journal
  retry limit was exhausted; and
- a final full-wallet recovery more than 15 minutes later still found no
  canonical hash; the reported private balance remained `189500` atomic units
  and the merchant intent remained open at zero received/pending value.

A later no-send diagnostic generated a fresh proof and passed exact populated
calldata simulation through all three configured RPCs (`1128365` pre-proof
estimate, `1123239` final estimate). It observed a `64892`-atomic fee, submitted
no payment and wrote no journal. This narrows the unresolved outcome to the
Broadcaster's off-chain path or sanitized response boundary; it does not pass
Gate B.

After the read-only admission guard was added, a fresh-intent proof selected at
least one nullifier held by the unresolved lineage. It returned
`SUBMISSION_ALREADY_RECORDED` before final simulation or Waku and wrote no new
journal record. The wallet's current `Spendable` projection therefore cannot be
used as evidence that those inputs are safe for a competing intent.

No secret, ignored config, wallet database or journal contents were opened to
record these observations; the values above were emitted by bounded tooling
during operator-authorized runs.

## Function record index

| Record | Security-critical role |
| --- | --- |
| [`runtime-create.md`](functions/runtime-create.md) | Merchant secret loading, process lock, engine/database construction |
| [`api-create-app.md`](functions/api-create-app.md) | HTTP public/authenticated route boundary and intent entry |
| [`intent-create-idempotent.md`](functions/intent-create-idempotent.md) | Request idempotency, opaque reference, descriptor and atomic intent insert |
| [`descriptor-verify.md`](functions/descriptor-verify.md) | Independent signer trust root on merchant and payer sides |
| [`view-only-engine-start.md`](functions/view-only-engine-start.md) | View-only wallet construction and no-spend runtime assertions |
| [`scanner-scan.md`](functions/scanner-scan.md) | Wallet refresh and strict payment-note admission |
| [`scanner-normalize-txo.md`](functions/scanner-normalize-txo.md) | Stable identity, finality and PPOI normalization |
| [`rpc-quorum.md`](functions/rpc-quorum.md) | Provider agreement for chain, receipts, blocks and finality heights |
| [`reconcile.md`](functions/reconcile.md) | Match/PPOI state, immutable identity, projection/outbox transaction |
| [`derive-projection.md`](functions/derive-projection.md) | Credited/pending sums and intent status derivation |
| [`webhook-deliver-pending.md`](functions/webhook-deliver-pending.md) | Signed delivery, retry and dead-letter transitions |
| [`backup-create.md`](functions/backup-create.md) | Offline state capture and inventory construction |
| [`backup-restore.md`](functions/backup-restore.md) | Inventory verification and identity-bound restore |
| [`payer-verify-request.md`](functions/payer-verify-request.md) | Payer-side descriptor and duplicated-field validation |
| [`payer-engine-start.md`](functions/payer-engine-start.md) | Full-wallet engine/import lifecycle |
| [`payer-runtime-lock.md`](functions/payer-runtime-lock.md) | Exclusive payer state ownership for normal CLI operations |
| [`payer-submission-journal.md`](functions/payer-submission-journal.md) | Initial/retry reservation, nullifier ownership, classified outcomes and canonical/receipt state |
| [`payer-sync-balances.md`](functions/payer-sync-balances.md) | Spendable/PPOI-bucket synchronization |
| [`payer-cli-pay-self-signed.md`](functions/payer-cli-pay-self-signed.md) | Explicit CLI execution gates |
| [`payer-send-self-signed-transfer.md`](functions/payer-send-self-signed-transfer.md) | Proof population and EVM submission |
| [`payer-read-secret.md`](functions/payer-read-secret.md) | Owner-only, identity-stable payer file loading |
| [`payer-broadcaster-discover.md`](functions/payer-broadcaster-discover.md) | Alternate-identity exclusion, quote ordering and Waku peer readiness before proof |
| [`payer-broadcaster-prepare-submission.md`](functions/payer-broadcaster-prepare-submission.md) | Fresh quote selection and local encrypted Waku transaction construction |
| [`payer-broadcaster-submit-prepared.md`](functions/payer-broadcaster-submit-prepared.md) | Irreversible SDK send boundary, returned-hash validation and response category dispatch |
| [`payer-broadcaster-failure-classification.md`](functions/payer-broadcaster-failure-classification.md) | Exact installed-response mapping to stable rejection/ambiguity enums |
| [`payer-send-broadcaster-transfer.md`](functions/payer-send-broadcaster-transfer.md) | Gate B proof, initial/retry reservation, classified Waku outcomes and canonical receipt lifecycle |
| [`payer-recover-broadcaster.md`](functions/payer-recover-broadcaster.md) | Terminal-state reporting and nullifier-based recovery/retry-availability derivation |
| [`payer-safe-failure-result.md`](functions/payer-safe-failure-result.md) | Top-level redacted payer CLI failure serialization |
| [`sdk-broadcaster-transaction-create.md`](functions/sdk-broadcaster-transaction-create.md) | Installed Waku client encrypted request/shared-response-key construction |
| [`sdk-broadcaster-transaction-send.md`](functions/sdk-broadcaster-transaction-send.md) | Installed Waku client retry, response and nullifier-completion loop |

## Coverage boundary of this context pass

Read in depth: root runtime/API/config/secret/lock, intent/descriptor/database,
scanner/RPC/PPOI, reconciliation/projection/outbox/webhook, backup/restore, and
the payer config/secrets/request/descriptor/engine/execution/submission/journal
flow.

Gate B extension read in depth: payer Broadcaster trust/session, proof and fee
path, populated-transfer/nullifier checks, exact response classification,
initial/same-nullifier retry journal state, recovery and final failure
serialization. The locally installed, exactly locked
`@railgun-community/waku-broadcaster-client-node@9.1.1` compiled distribution was
followed through fee-message verification/cache selection,
`BroadcasterTransaction.create`, response-key storage, LightPush send, Store
retrieval, response decryption, retry/timeout and Wallet nullifier fallback
(`tools/ppops-payer/package-lock.json:L3661-L3676`). Its `@waku/sdk`, libp2p,
cryptographic Wallet calls and remote peers remain external dependencies.

Oriented but not micro-analyzed: mainnet-gate evidence implementation, pilot
webhook receiver, health bookkeeping, Railway diagnostic utility, kill-test
scripts, Docker/CI/release workflows, and test helper code. The root/payer test
discovery and coverage boundary was checked organizationally but individual
test helpers were not micro-analyzed. Third-party package
internals, public-chain contracts, RPC implementations, PPOI implementations,
and the RAILGUN cryptographic protocol were treated as external dependencies.
