## `PPOpsRuntime.create` in `src/runtime.ts` (L41-L91)

**Purpose:** Constructs the merchant runtime only after loading its configured
secrets, acquiring exclusive process ownership, proving the RAILGUN wallet is
view-only, and opening the two durable stores. Every daemon and one-shot scan
enters through this factory (`src/cli.ts:L330-L354`).

**Inputs & Assumptions:**

- `configPath` (string): operator-selected configuration path. Trust:
  semi-trusted local input; `loadConfig` parses it and resolves storage/secret
  paths (`src/config.ts:L256-L285`).
- Implicit: local filesystem contents, current OS account, RAILGUN Wallet SDK,
  RPC/PPOI availability, and a process-wide RAILGUN engine singleton.
  Established by: host/runtime environment and pinned external dependencies.
- Precondition: every secret file exists, has an accepted format, and is private
  on non-Windows. Established by `readOwnerOnlyFile` plus `readSecret`
  (`src/security/private-file.ts:L9-L58`; `src/security/secrets.ts:L31-L57`).
- Precondition: no other PPOps runtime owns the same SQLite path. Established by
  `RuntimeLock.acquire` before storage startup (`src/runtime.ts:L53-L58`;
  `src/security/runtime-lock.ts:L38-L66`).
- Precondition: the viewing key corresponds to the intended receiver. The
  persisted fingerprint/address consistency is checked by the engine, but
  merchant ownership of the receiver is established by: **nothing found**.

**Outputs & Effects:**

- Returns an initialized `PPOpsRuntime` containing config, database, view-only
  engine, scanner, API token, optional webhook service, and intent service.
- Opens/creates RAILGUN LevelDB/artifacts/wallet state and SQLite.
- Creates a runtime-lock file; it remains until `stop` releases it.
- Holds API, merchant-signing, viewing, DB-encryption, and optional HMAC secrets
  in process memory.
- On an initialization error, closes the resources that reached construction
  and releases the lock (`L84-L89`).

---

**Block-by-Block:**

```ts
// L42-L52
const config = await loadConfig(configPath);
const [apiToken, merchantPrivateKey, dbEncryptionKey, viewingKey] =
  await Promise.all([/* readSecret calls */]);
```

- **What:** Parses configuration and loads four independently typed secrets.
- **Why here:** No engine, lock, or database is opened until path/schema and
  secret-format checks complete.
- **Assumes:** File contents remain protected after reading; OS/account
  integrity is outside this function. Established by: owner-only file checks
  before reading; post-read process-memory isolation is a host runtime contract.
- **Establishes:** The in-memory values meet format and file-mode checks.
- **Depended on by:** API authentication, descriptor signing, RAILGUN DB
  decryption, and receiver note decryption.

```ts
// L53-L60
const engine = new RailgunViewOnlyEngine(config, dbEncryptionKey, viewingKey);
const lock = await RuntimeLock.acquire(runtimeLockPath(config.storage.sqlitePath));
...
await engine.start();
database = new PPOpsDatabase(config.storage.sqlitePath);
scanner = new RailgunScanner(engine, config);
```

- **What:** Constructs the engine, acquires exclusive runtime ownership, then
  starts the wallet/provider and opens merchant state.
- **Why here:** The lock precedes both persistent stores, so two normal runtime
  factories cannot concurrently open them.
- **Assumes:** Every process using these paths follows this factory/lock
  discipline. Established by root CLI callers; arbitrary library consumers are
  not forced to use it and are covered by: **nothing found** at the export
  boundary.
- **Establishes:** One initialized view-only wallet and SQLite handle are paired
  under one lock.
- **Depended on by:** Scheduled scans, intent creation, backup stop checks, and
  orderly shutdown.

```ts
// L61-L83
const intents = new IntentService(..., engine.railgunAddress, merchantPrivateKey);
...
webhook = new WebhookDeliveryService(database, config.webhook, webhookKey);
return new PPOpsRuntime(...);
```

- **What:** Binds new descriptors to the address derived by the loaded
  view-only wallet and conditionally enables one configured webhook.
- **Why here:** The receiver address cannot be used until engine startup has
  verified/loaded wallet identity.
- **Assumes:** Merchant signer and receiver identity are the intended production
  pair. Established by: configured signer secret plus loaded receiver state;
  a cryptographic relation between them is established by: **nothing found**.
- **Establishes:** One runtime profile fixes signer, chain/token, recipient,
  database, and webhook configuration for its lifetime.
- **Depended on by:** `IntentService.createRecord`, `createApiApp`, and
  reconciliation delivery.

```ts
// L84-L89
} catch (error) {
  await scanner?.close().catch(() => undefined);
  database?.close();
  await engine.stop().catch(() => undefined);
  await lock.release().catch(() => undefined);
  throw error;
}
```

- **What:** Performs reverse cleanup and rethrows the original startup error.
- **Why here:** Prevents a partial initialization from retaining the process
  lock or external providers.
- **Assumes:** Suppressing cleanup errors is acceptable because startup already
  failed. Established by: the explicit catch order at `L84-L89`; an independent
  guarantee that suppressed cleanup completed is established by: **nothing
  found**.
- **Establishes:** A failed factory call does not intentionally retain its lock.
- **Depended on by:** CLI error handling and subsequent restart attempts.

---

**Cross-Function Dependencies:**

- Callee `loadConfig` (internal): applies owner-only regular-file checks,
  validates profile rules, and prevents configured storage/secret path overlap
  (`src/config.ts:L256-L285`).
- Callee `readSecret` (internal): mode/regular-file and kind-format checks
  (`src/security/private-file.ts:L9-L58`; `src/security/secrets.ts:L31-L57`).
- Callee `RuntimeLock.acquire` (internal): exclusive file creation and stale-PID
  handling (`src/security/runtime-lock.ts:L38-L66`).
- Callee `RailgunViewOnlyEngine.start` (internal plus external SDK): enforces
  persisted key identity and exercises the no-full-wallet/no-signature
  guarantees (`src/railgun/engine.ts:L202-L262`).
- Callee `PPOpsDatabase` constructor (internal plus `better-sqlite3`): opens the
  state database with WAL/foreign keys/full sync and schema migration
  (`src/db/database.ts:L135-L156`).
- Callers: `serve` and `scanOnce` only in product CLI
  (`src/cli.ts:L330-L354`).
- Shared state: RAILGUN SDK singleton, LevelDB, SQLite, wallet state, runtime-lock
  file, and process-held secrets.

**Open Questions:**

- Whether external library consumers construct `RailgunViewOnlyEngine` or
  `PPOpsDatabase` without the runtime lock is not constrained by module exports.
- Windows-equivalent secret file ACL enforcement is not represented here.
