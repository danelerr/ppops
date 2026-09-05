# Architecture

PPOps is a self-hosted, view-only payment reconciler for one merchant RAILGUN
receiver on Arbitrum native USDC. It maps encrypted, random payment references
to local merchant intents without publishing invoice metadata or holding
spending authority.

## System context

~~~text
                         merchant trust domain
                 +--------------------------------+
merchant app --->| Bearer API                     |
                 |                                |
                 | PPOps daemon                   |
                 |  - intent service              |
                 |  - EIP-712 descriptor signer   |
                 |  - view-only RAILGUN scanner   |
                 |  - reconciler                  |
                 |  - SQLite + encrypted LevelDB  |
merchant app <---| HMAC outbox                    |
                 +---------------+----------------+
                                 |
                                 | shareable viewing capability
                                 v
                            RAILGUN notes
                                 ^
                                 | private ERC-20 + encrypted memo
                                 |
                 +---------------+----------------+
                 | separate payer trust domain    |
                 | full RAILGUN spending wallet   |
                 +--------------------------------+
~~~

The merchant's full receiver wallet may live on a third device. Only its
shareable viewing key is imported into PPOps. tools/ppops-payer is co-located in
the Git repository for reproducibility but is excluded from the daemon build,
Docker image, imports, storage, and runtime.

## Merchant request flow

1. The merchant backend creates an authenticated intent containing local
   externalReference, expected amount, and expiry.
2. PPOps generates a random 32-byte reference and stores its local mapping.
3. PPOps creates a versioned descriptor containing chain, token, amount, 0zk
   recipient, reference, expiry, nonce, and merchant signer.
4. The independent merchant identity key signs the descriptor using EIP-712.
5. PPOps returns an unguessable checkout path and metadata-minimal request.json.

Invoice and customer identifiers never enter the memo or public payer request.
The expected merchant signer must be pinned outside the request.

## Settlement flow

1. The payer verifies the signed descriptor.
2. The payer sends a private RAILGUN ERC-20 transfer to the receiver and sets
   memoText to ppops:v1:0x<random-reference>.
3. RAILGUN encrypts the memo for authorized sender/receiver viewing.
4. The PPOps scanner imports only the merchant shareable viewing capability and
   discovers the receiver note.
5. PPOps records a stable settlement identity:

~~~text
chainId:txidVersion:normalizedPublicTransactionHash:tree:position
~~~

6. The reconciler checks network, token, receiver, strict memo/reference,
   finality, and PPOI.
7. SQLite projects the intent amount/state and inserts an event into a
   transactional outbox.
8. The outbox delivers a timestamped HMAC webhook and records retries,
   delivery, or dead-letter state.

The reference is not a settlement ID because one intent can receive multiple
partial payments.

## Orthogonal state

Settlement facts are not collapsed into one enum:

~~~text
chainStatus: OBSERVED | CONFIRMED | FINALIZED | REVERTED
poiStatus:   UNKNOWN | PENDING | SPENDABLE | BLOCKED
matchStatus: UNMATCHED | MATCHED | CONFLICT
~~~

The merchant intent is derived from credited settlements:

~~~text
OPEN | PARTIAL | PAID | EXPIRED | PAID_LATE
~~~

A settlement contributes to receivedAmountAtomic only when finality, PPOI
spendability, and matching criteria all hold. Overpayment is an amount, not a
separate terminal state.

## Storage

~~~text
SQLite
  intents
  idempotency
  settlements
  events
  transactional outbox

encrypted RAILGUN LevelDB
  viewing-wallet scan/index state

wallet-state file
  receiver identity/import state

secret files
  viewing capability
  DB encryption
  API authentication
  descriptor identity
  webhook HMAC
~~~

Losing SQLite loses the private reference-to-order mapping. Chain-only recovery
cannot recreate it. LevelDB and SQLite are backed up offline with authenticated
secret backups managed separately.

## Developer experience modules

The current source includes a lightweight HTTP client (`src/client.ts`), shared
API schemas/OpenAPI, and an isolated demo. The demo uses temporary databases and
simulated settlement facts; its confirmation routes are never registered by the
real daemon. The merchant example uses the same webhook verification and stores
order/event transitions atomically. These modules do not expand the daemon's
spending authority or replace the separate payer runtime.

## API surfaces

Public, metadata-minimal:

- liveness/readiness/health;
- unguessable checkout and request.json;
- static checkout assets.

Bearer-authenticated:

- intent creation/read;
- settlement, event, and outbox inspection;
- redacted runtime;
- metadata-free metrics;
- dead-letter replay;
- descriptor verification.

There is no endpoint to register arbitrary webhook destinations. Webhooks are
outbound-only and configured at startup.

## External dependencies

PPOps owns local intent state and reconciliation policy. It depends on:

- RAILGUN contracts, Wallet SDK, proving artifacts, PPOI semantics, and private
  notes;
- Arbitrum and Ethereum-backed finality;
- the operator's RPC majority;
- the operator's PPOI endpoint(s);
- DNS/network and the merchant webhook receiver;
- Waku/Broadcasters only for the optional reference payer mode.

It does not operate these services and does not hide their availability or
trust assumptions.

## Security properties and non-goals

PPOps aims to:

- keep merchant spending authority outside the daemon;
- keep invoice/customer metadata off public payment artifacts;
- require finality + PPOI spendability + matching;
- make creation, settlement identity, events, retries, and restart behavior
  idempotent;
- expose executable, metadata-minimal privacy and mainnet evidence.

PPOps does not:

- create payment privacy for public EVM transfers;
- make viewing-key compromise harmless;
- guarantee payer network anonymity or Broadcaster availability;
- custody/refund funds;
- replace the merchant's fulfillment database;
- provide a consumer wallet, fiat conversion, compliance service, or generic
  multichain payment protocol.

See [PRODUCT-MODEL.md](PRODUCT-MODEL.md) for positioning,
[OPERATIONAL-PROFILE.md](OPERATIONAL-PROFILE.md) for exact v0.1 semantics, and
[THREAT-MODEL.md](THREAT-MODEL.md) for adversarial analysis.
