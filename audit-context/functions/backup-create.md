## `createBackup` in `src/backup.ts` (L127-L217)

**Purpose:** Produces an offline, new-directory snapshot of SQLite, encrypted
RAILGUN state, wallet identity/artifacts, and optionally service/viewing secrets,
plus an exact file inventory and secret-identity fingerprints.

**Inputs & Assumptions:**

- `configPath`, `outputPath`: semi-trusted local CLI inputs.
- `includeSecrets`: explicit local operator flag.
- Local source state and secret files: trusted current runtime state.
- Precondition: daemon is stopped. Established by `RuntimeLock.assertStopped`
  (`L132-L135`), which relies on PID liveness.
- Precondition: destination does not exist. Checked before staging (`L134-L141`).

**Outputs & Effects:**

- Creates a private staging directory, SQLite backup, recursive RAILGUN cache,
  optional artifacts, wallet state, optionally secrets, and `manifest.json`.
- Manifest records network/token, secret fingerprints, and every file's
  size/SHA-256.
- Atomically renames staging directory to requested output when complete.
- Returns output path and manifest.

---

**Block-by-Block:**

```ts
// L132-L153
const config = await loadConfig(...);
await RuntimeLock.assertStopped(...);
/* require new output; create private staging */
const sourceDatabase = new Database(sqlitePath, { readonly: true, fileMustExist: true });
await sourceDatabase.backup(sqliteDestination);
```

- **What:** Establishes offline/new-target conditions and uses SQLite's backup
  API rather than copying live WAL files.
- **Why here:** Consistent SQLite snapshot precedes packaging other state.
- **Assumes:** All writers honor the runtime lock. Established for root daemon/
  scan paths by `PPOpsRuntime.create`; for arbitrary direct database use:
  **nothing found**.
- **Establishes:** Staged SQLite is a database-produced backup from a stopped
  normal runtime.
- **Depended on by:** Restore validation.

```ts
// L156-L183
copyOptionalPath(railgunDbPath, ...);
copyOptionalPath(artifactsPath, ...);
copyPrivateFile(walletStatePath, ...);
const requiredSecrets = await readRequiredBackupSecrets(config);
if (includeSecrets) { /* copy secret files */ }
```

- **What:** Copies encrypted wallet state and fingerprints all required recovery
  identities; secret values are copied only under explicit flag.
- **Why here:** Manifest can bind a state-only backup to separately managed
  secrets.
- **Assumes:** A stopped engine has flushed LevelDOWN state. SDK shutdown/flush
  guarantees are external. Established by: the prior runtime-stop precondition
  and the pinned SDK/LevelDOWN lifecycle; **nothing found in project source**
  specifies its flush contract.
- **Establishes:** Required LevelDB/wallet state exists; included secret files
  are mode-adjusted to 0600 on non-Windows.
- **Depended on by:** Manifest identity fields and restore compatibility.

```ts
// L185-L216
const files = await Promise.all(relativeFiles.map(/* sha256 + size */));
const manifest = { /* profile, fingerprints, inventory */ };
await writeFile(manifest.json, ... "wx");
await rename(staging, output);
```

- **What:** Inventories the finished staging tree, writes manifest, and publishes
  by rename.
- **Why here:** The manifest covers every non-manifest file after copy.
- **Assumes:** Rename is atomic on the selected filesystem and destination stays
  absent. Established by: the external filesystem rename contract and the
  destination checks at `L134-L141`.
- **Establishes:** A published backup has one complete inventory and no symlink/
  special file accepted by `listFiles` (`L78-L87`).
- **Depended on by:** `verifyBackup` and restore.

---

**Cross-Function Dependencies:**

- Callees `loadConfig`, `RuntimeLock.assertStopped`, `readSecret` (internal).
- `better-sqlite3` backup and filesystem copy/rename are external platform
  dependencies.
- Caller: CLI `backup` command (`src/cli.ts:L395-L410`).
- Shared state: merchant SQLite/LevelDB/artifacts/wallet state and optionally all
  configured secrets.

**Open Questions:**

- Whether artifact/cache files are fully flushed after engine shutdown depends
  on the pinned SDK/LevelDOWN lifecycle.
- Staging cleanup after a mid-backup failure is not described by this function;
  partial directory remains named with `.partial-*`.
