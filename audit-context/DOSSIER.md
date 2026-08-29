# PPOps audit context dossier

Context-building snapshot: 2026-08-29. This document describes the final source
tree through commits `9c42664` and `68b8c77`. Review began from root commit
`89256e9e2fa2f4d388c9b2dd96adb5ef588fe8ef`; the payer subtree was originally
imported from commit
`300bcb7c5a52ad7955ce317f15a120b3138c48e6`. This is an orientation record, not
a vulnerability report, severity assessment, or production-readiness claim.

Ignored runtime state and secret/configuration contents were not opened. In
particular, no contents under `secrets/`, `data/`, `instance/`, `backups/`,
`restore/`, `pilot/`, `pilot-evidence/`, or `tools/ppops-payer/{secrets,data,artifacts}`
were inspected. The untracked `justito-hackathon-deck.html` was not read or
modified.

## System shape

The repository contains two independently executable Node/TypeScript packages:

1. `ppops` is a merchant-side view-only reconciler. Its binary is
   `dist/cli.js` (`package.json:L24-L26`). It accepts a RAILGUN shareable viewing
   key, an independent merchant EIP-712 key, an API token, an encrypted-wallet
   database key, and optionally a webhook HMAC key
   (`src/runtime.ts:L41-L72`). It creates payment intents, watches receiver
   notes, derives payment state, and emits an outbox/webhook.
2. `tools/ppops-payer` is a payer-side Gate A harness. Its binary is also built
   separately (`tools/ppops-payer/package.json:L17-L19`). It accepts a payer
   mnemonic when first importing a full RAILGUN wallet and a separate EVM key
   for self-signed transaction submission
   (`tools/ppops-payer/src/cli.ts:L230-L255`). It does not run in the merchant
   daemon. An executable boundary check rejects merchant imports of payer code,
   payer imports that escape its package, merchant spending-material options,
   payer inclusion in the merchant build, and Docker copies of payer tooling
   (`scripts/trust-boundary-check.ts:L31-L80`).

The verification boundary mirrors the runtime boundary: root Vitest discovery
is limited to `test/**/*.test.ts` and root coverage to `src/**/*.ts`
(`vitest.config.ts:L3-L16`); payer tests/build/audit execute from the payer
package through its own `verify` script (`tools/ppops-payer/package.json:L23-L28`).
Root `verify:all` composes the two runs without merging their test discovery or
coverage accounting (`package.json:L38-L43`).
The final separate test runs for this snapshot reported 17 merchant files / 52
tests and 7 payer files / 19 tests.

The protocol path is:

```text
merchant backend
  -> authenticated PPOps API
  -> SQLite intent + opaque reference + signed descriptor
  -> public metadata-minimal request.json
  -> independently pinned merchant signer verification on payer host
  -> full RAILGUN payer wallet + encrypted memo + private ERC-20 proof
  -> Arbitrum RAILGUN proxy transaction
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
| Payer CLI `main` | Local process arguments (`tools/ppops-payer/src/cli.ts:L423-L460`) | OS user, owner-only config/secrets, explicit command bounds | Full-wallet import/cache, sync state, submission journal state, or one self-signed spend submission |
| Payer `submission-status` | Local process arguments (`tools/ppops-payer/src/cli.ts:L314-L337`) | OS user and owner-only payer config/journal | None; reports absent, `SUBMITTING`, or `SUBMITTED` plus a recorded hash |
| Payer request loader | HTTPS or loopback HTTP, or local file (`tools/ppops-payer/src/request.ts:L118-L148`) | Descriptor must later verify against signer supplied out of band | None until `pay-self-signed` proceeds |

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
  wallet cache and its creation block (`tools/ppops-payer/src/railgun/engine.ts:L267-L301`).
- The mnemonic is read only when the wallet-state file does not exist; the EVM
  private key is read only for self-signed submission
  (`tools/ppops-payer/src/cli.ts:L230-L245`).
- The payer config, DB key, mnemonic, and EVM key are resolved relative to the
  payer config and required to occupy distinct paths
  (`tools/ppops-payer/src/config.ts:L87-L137`).
- There is no shared database or direct import boundary between the merchant
  and payer packages. Their deliberate coupling is the request JSON and signed
  descriptor format.
- Payer CLI engine operations acquire a PID/token lock derived from the
  wallet-state path before engine construction and release it after shutdown
  (`tools/ppops-payer/src/cli.ts:L339-L362`;
  `tools/ppops-payer/src/security/runtime-lock.ts:L38-L78`).
- A JSON submission journal adjacent to wallet state records an intent as
  `SUBMITTING` before EVM submission and, after ethers returns a hash, as
  `SUBMITTED` with that hash
  (`tools/ppops-payer/src/security/submission-journal.ts:L12-L45`,
  `L63-L102`).

## Trust boundaries and external dependencies

| Boundary | Data crossing | Code-side establishment |
| --- | --- | --- |
| Merchant backend -> PPOps API | Intent metadata and idempotency key | Schema validation at `src/api/app.ts:L20-L35`; Bearer middleware at `L272-L282`; creation at `L294-L321` |
| PPOps checkout -> payer | Chain/token/amount, recipient, memo, descriptor | Minimal checkout projection at `src/api/app.ts:L65-L82`; payer verifies all duplicated fields at `tools/ppops-payer/src/request.ts:L51-L93` |
| Trusted merchant identity -> payer | Expected EVM signer | Supplied separately as CLI input at `tools/ppops-payer/src/cli.ts:L286-L296`; signature comparison at `tools/ppops-payer/src/descriptor.ts:L54-L73` |
| Merchant host -> local filesystem | Config, secrets, SQLite, LevelDB, artifacts | Owner/file/type/size/identity checks at `src/security/private-file.ts:L9-L58`; schema/path checks; OS filesystem remains part of the trusted base |
| Payer host -> local filesystem | Mnemonic, full-wallet cache, EVM key | Owner/file/type/size/identity checks at `tools/ppops-payer/src/security/private-file.ts:L9-L58` |
| Both processes -> RAILGUN Wallet SDK | Viewing key or mnemonic, wallet DB key, notes, proofs, balances, PPOI buckets | Pinned package versions at root `package.json:L55-L64` and payer `package.json:L30-L37`; SDK behavior is external to project source |
| Scanner -> RPC providers | Chain ID, latest/finalized heights, receipts, blocks | Majority grouping/height clustering in `src/railgun/rpc-quorum.ts:L68-L175` |
| Wallet SDK -> PPOI nodes | PPOI health/proof/bucket data | URL/profile constraints at `src/config.ts:L144-L221`; health preflight at `src/railgun/ppoi-preflight.ts:L18-L68`; proof semantics remain an SDK/PPOI dependency |
| Payer -> one submission RPC | Network/fee reads and raw transaction submission | First healthy provider selection with chain-ID check at `tools/ppops-payer/src/railgun/self-signed-transfer.ts:L49-L75` |
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

### Financial authority

- Root PPOps has no RAILGUN spending credential in its configuration schema
  (`src/config.ts:L82-L88`) and checks that the loaded wallet cannot be resolved
  or used as a full/signing wallet (`src/railgun/engine.ts:L227-L246`).
- `tools/ppops-payer` intentionally has spending authority: it imports a mnemonic
  (`tools/ppops-payer/src/railgun/engine.ts:L286-L289`) and sends through an EVM
  signer (`tools/ppops-payer/src/railgun/self-signed-transfer.ts:L232-L250`).

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
11. **Payer process exclusivity.** Normal `sync` and `pay-self-signed` engine
    operations use `withEngine`, which acquires a PID/token lock before engine
    construction and releases it after shutdown
    (`tools/ppops-payer/src/cli.ts:L339-L362`).
12. **Payer execution is explicitly bounded.** The CLI requires exact intent ID,
    amount cap, expected payer 0zk address, expected EVM signer, and gas-cost cap
    before calling the spend path (`tools/ppops-payer/src/cli.ts:L375-L409`). The
    populated transaction must target the configured RAILGUN proxy and carry
    zero ETH (`tools/ppops-payer/src/railgun/self-signed-transfer.ts:L198-L230`).
13. **Bounded CLI failure output.** Root command failures are classified into a
    fixed code (`src/security/failures.ts:L1-L65`) at the final CLI boundary
    (`src/cli.ts:L592-L604`). Payer runtime errors are likewise reduced to a
    fixed code (`tools/ppops-payer/src/events.ts:L18-L50`); payer progress events
    contain selected SDK status/progress fields rather than caught error text.
    This relies on command
    failures reaching the respective final boundaries.
14. **One local payer submission per intent.** The transfer path refuses an
    existing intent record, reserves `SUBMITTING` immediately before the
    network call, and records `SUBMITTED` after receiving a transaction hash
    (`tools/ppops-payer/src/railgun/self-signed-transfer.ts:L104-L107`,
    `L241-L250`; `tools/ppops-payer/src/security/submission-journal.ts:L54-L102`).
15. **Verification results preserve package ownership.** Merchant test discovery
    and coverage include only root `test/` and `src/`; payer verification runs
    separately from `tools/ppops-payer`. `verify:all` requires both package
    pipelines (`vitest.config.ts:L3-L16`; `package.json:L38-L43`;
    `tools/ppops-payer/package.json:L23-L28`).

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
  (`tools/ppops-payer/src/security/submission-journal.ts:L120-L140`). An
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
| [`payer-submission-journal.md`](functions/payer-submission-journal.md) | Pre-send reservation and transaction-hash state for each payer intent |
| [`payer-sync-balances.md`](functions/payer-sync-balances.md) | Spendable/PPOI-bucket synchronization |
| [`payer-cli-pay-self-signed.md`](functions/payer-cli-pay-self-signed.md) | Explicit CLI execution gates |
| [`payer-send-self-signed-transfer.md`](functions/payer-send-self-signed-transfer.md) | Proof population and EVM submission |
| [`payer-read-secret.md`](functions/payer-read-secret.md) | Owner-only, identity-stable payer file loading |

## Coverage boundary of this context pass

Read in depth: root runtime/API/config/secret/lock, intent/descriptor/database,
scanner/RPC/PPOI, reconciliation/projection/outbox/webhook, backup/restore, and
the payer config/secrets/request/descriptor/engine/execution/submission/journal
flow.

Oriented but not micro-analyzed: mainnet-gate evidence implementation, pilot
webhook receiver, health bookkeeping, Railway diagnostic utility, kill-test
scripts, Docker/CI/release workflows, and test helper code. The root/payer test
discovery and coverage boundary was checked organizationally but individual
test helpers were not micro-analyzed. Third-party package
internals, public-chain contracts, RPC implementations, PPOI implementations,
and the RAILGUN cryptographic protocol were treated as external dependencies.
