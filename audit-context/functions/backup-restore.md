## `restoreBackup` in `src/backup.ts` (L243-L355)

**Purpose:** Restores an offline merchant state bundle only after verifying its
inventory/profile and binding it to either bundled or pre-existing recovery
secrets.

**Inputs & Assumptions:**

- `configPath`, `backupPath`: semi-trusted local operator input.
- `force`: authority to move existing targets aside.
- Backup directory: untrusted until schema/inventory/hash checks complete.
- Current secret set: trusted local identity when bundle excludes secrets.
- Precondition: daemon stopped; `RuntimeLock.assertStopped` at L248-L250.
- Precondition: backup provenance is trusted by operator. Cryptographic
  authentication of manifest provenance is established by: **nothing found**.

**Outputs & Effects:**

- Verifies manifest schema, exact file inventory, file sizes/hashes, network and
  token profile, and recovery-secret identity.
- Without `force`, refuses any existing target; with `force`, renames each to
  `*.pre-restore-<timestamp>`.
- Copies state and optional secrets into configured paths.
- Rechecks secret identity and opens/migrates SQLite as final validation.

---

**Block-by-Block:**

```ts
// L248-L258
const config = await loadConfig(...);
await RuntimeLock.assertStopped(...);
const manifest = await verifyBackup(backupRoot);
if (manifest.network... !== config.network...) throw ...;
```

- **What:** Establishes offline state, exact inventory integrity, and profile
  compatibility before touching targets.
- **Why here:** A mismatched/corrupt backup cannot trigger replacement steps.
- **Assumes:** SHA-256 inventory detects mutation but does not identify who made
  the manifest. Established by: hash/size verification in `verifyBackup`; an
  authenticated manifest signer is established by: **nothing found**.
- **Establishes:** Every listed backup file matches its recorded bytes and the
  restore profile matches.
- **Depended on by:** Secret identity and copy phase.

```ts
// L260-L287
if (manifest.containsSecrets) {
  /* read bundled required secrets; compare fingerprints/signer */
  /* require all-or-none existing required secrets; compare if present */
} else {
  assertSecretIdentity(await readRequiredBackupSecrets(config), manifest);
}
```

- **What:** Binds state to bundled secrets, external existing secrets, or both.
- **Why here:** Encrypted wallet state and receiver/signer identity must match
  before replacing live paths.
- **Assumes:** Domain-separated SHA-256 fingerprints of high-entropy keys are
  sufficient comparison; merchant signer address compares private-key identity.
  Established by: `assertSecretIdentity` at `L111-L125` plus external SHA-256/
  EVM key-derivation contracts.
- **Establishes:** The required recovery identities supplied for restore match
  the manifest.
- **Depended on by:** Successful LevelDB/wallet reloading after restore.

```ts
// L289-L324
for (const target of [...stateTargets, ...secretTargets]) {
  await moveAsideIfNeeded(target, force, suffix);
}
/* copy SQLite, LevelDB, optional artifacts, wallet state */
```

- **What:** Preflights or renames all targets, then copies state.
- **Why here:** Non-force detects existing paths before copying; force retains
  prior material instead of deleting it.
- **Assumes:** All target paths are distinct/non-overlapping, established by
  `loadConfig` (`src/config.ts:L256-L285`).
- **Establishes:** New configured state paths contain backup contents; preexisting
  state is recoverable under renamed paths in force mode.
- **Depended on by:** Final validation and later runtime start.

```ts
// L326-L354
if (manifest.containsSecrets) { /* copy optional bundle secrets */ }
assertSecretIdentity(await readRequiredBackupSecrets(config), manifest);
const validationDatabase = new PPOpsDatabase(sqlitePath);
validationDatabase.close();
return ...;
```

- **What:** Restores bundled secrets if present, rebinds identity after copy, and
  validates SQLite schema/openability.
- **Why here:** Confirms configured final locations, not only backup sources.
- **Assumes:** Successful SQLite open/migration is sufficient local validation;
  RAILGUN engine/wallet load is not performed here. Established by: the explicit
  final validation at `L351-L353`; broader RAILGUN validation at this boundary
  is established by: **nothing found**.
- **Establishes:** Required secrets and SQLite agree with manifest/schema at
  function return.
- **Depended on by:** Subsequent isolated runtime restart/gate evidence.

---

**Cross-Function Dependencies:**

- Callee `verifyBackup` (internal, L219-L235): strict manifest, exact path list,
  SHA-256/size checks; `FileEntrySchema` forbids absolute/`..` paths (`L25-L53`).
- Callee `assertSecretIdentity` (internal, L111-L125): fingerprints viewing/DB
  keys and derives merchant signer.
- Callee `moveAsideIfNeeded` (internal, L237-L241): refuse or rename.
- Callee `PPOpsDatabase` validates/migrates SQLite, but RAILGUN state validation
  waits for the next runtime start.
- Caller: CLI `restore` command (`src/cli.ts:L412-L424`).

**Open Questions:**

- Restore has multiple filesystem copy steps without a single filesystem-wide
  transaction; intended operator recovery from a mid-copy interruption is not
  specified in source.
- RAILGUN LevelDB/wallet identity is not opened at return; validation is deferred
  to `PPOpsRuntime.create`.
