## `PayerRuntimeLock.acquire` in `tools/ppops-payer/src/security/runtime-lock.ts` (L38-L67)

**Purpose:** Gives normal payer CLI engine operations exclusive ownership of one
wallet-state/LevelDB runtime domain before the full RAILGUN engine is constructed.

**Inputs & Assumptions:**

- `path`: internally derived as `<walletStatePath>.runtime-lock` (`L77-L78`).
- Implicit: current PID, process table, filesystem exclusive-create and rename
  semantics, random UUID source. Established by: Node process/filesystem/crypto
  runtime contracts.
- Precondition: every process writing the associated payer state participates in
  this lock. Established for `sync` and `pay-self-signed` through `withEngine`;
  for direct engine consumers: **nothing found**.

**Outputs & Effects:**

- Creates a mode-0600 lock file exclusively, containing schema version, PID,
  random ownership token, and creation timestamp.
- If a lock exists for a live/permission-hidden PID, throws.
- If the recorded PID is not live or contents are absent/malformed in an
  accepted way, renames the lock aside and retries once.
- Returns an object whose `release` removes the file only if its random token
  still matches (`L69-L74`).

---

**Block-by-Block:**

```ts
// L39-L46
await mkdir(dirname(path), { recursive: true, mode: 0o700 });
const token = randomUUID();
const contents = { schemaVersion: 1, pid: process.pid, token, createdAt: ... };
```

- **What:** Prepares a private parent and unique ownership record.
- **Why here:** Release must distinguish this owner from a replacement lock.
- **Assumes:** UUID uniqueness and process PID meaning on this host. Established
  by: Node `randomUUID`, `process.pid`, and host process-table contracts.
- **Establishes:** Candidate lock contents uniquely bind this acquisition.
- **Depended on by:** Exclusive create/release token comparison.

```ts
// L47-L56
const handle = await open(path, "wx", 0o600);
await handle.writeFile(...);
await handle.sync();
await handle.close();
return new PayerRuntimeLock(path, token);
```

- **What:** Uses exclusive file creation, persists/syncs ownership, then returns.
- **Why here:** Only one contender can create a missing path.
- **Assumes:** Filesystem honors `wx` exclusivity and file-sync semantics.
  Established by: the host filesystem contract used at `L47-L56`.
- **Establishes:** Successful caller owns the token recorded at the lock path.
- **Depended on by:** `withEngine` start and later `release`.

```ts
// L57-L64
if (code !== "EEXIST") throw error;
const existing = await readLock(path);
if (existing && safePid && processIsAlive(existing.pid)) throw ...;
await rename(path, `${path}.stale-${Date.now()}`);
```

- **What:** Distinguishes a live owner from stale state and preserves stale file
  by rename.
- **Why here:** Abnormal prior exit does not permanently block a later command.
- **Assumes:** PID liveness is sufficient ownership test; PID reuse and host/
  namespace semantics are outside the file contents. Established by:
  `processIsAlive` at `L12-L19`; stronger owner identity is established by:
  **nothing found**.
- **Establishes:** A recognized live owner prevents startup; otherwise a retry
  sees a missing canonical path.
- **Depended on by:** Second and final acquisition attempt.

---

**Cross-Function Dependencies:**

- Internal `processIsAlive` treats signal success or `EPERM` as alive
  (`L12-L19`).
- Internal `readLock` parses JSON without a schema validator (`L21-L28`); fields
  are checked only where used.
- Caller `withEngine` acquires before construction and releases after engine
  stop (`tools/ppops-payer/src/cli.ts:L339-L362`).
- Shared state: one runtime-lock file beside wallet state; stale files accumulate
  under timestamped names but are not consulted again.

**Open Questions:**

- Expected behavior under PID reuse/container namespaces is not specified.
- Direct uses of exported `PayerRailgunEngine` are not mechanically tied to this
  lock.
