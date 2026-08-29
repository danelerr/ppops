## `readOwnerOnlyFile` in `tools/ppops-payer/src/security/private-file.ts` (L41-L58)

**Purpose:** Provides the payer's common local-file trust boundary for config,
wallet state, DB key, mnemonic, and EVM private key by requiring a small,
owner-controlled, non-symlink regular file and verifying the opened object is
the one checked by path.

**Inputs & Assumptions:**

- `path`: config- or CLI-derived local path. Trust: semi-trusted operator input.
- `policy.label`, `policy.maxBytes`: trusted internal policy selected by caller.
- Implicit: local filesystem and current OS user identity. Established by:
  Node filesystem metadata and `process.getuid` on supported platforms.
- Precondition: on Windows, equivalent ACL protection must be supplied by the
  operator; application enforcement is established by: **nothing found**.

**Outputs & Effects:**

- Returns UTF-8 file content; caller applies JSON or secret-kind validation.
- Rejects symlinks/non-files, oversized files, group/other access, and another
  owner on non-Windows (`L9-L30`).
- Opens with `O_NOFOLLOW` where supported, repeats all metadata checks on the
  handle, and requires pre/post device and inode identity.
- No durable write; returned sensitive content enters JavaScript memory.

---

**Block-by-Block:**

```ts
// L45-L47
const beforeOpen = await assertOwnerOnlyRegularFile(path, policy);
const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
const handle = await open(path, constants.O_RDONLY | noFollow);
```

- **What:** Applies path-level policy then opens read-only with no-follow when
  supported.
- **Why here:** The path must be acceptable before reading any bytes.
- **Assumes:** Platform `lstat/open/O_NOFOLLOW` semantics and parent-directory
  controls. Established by: the host filesystem contract; parent-directory
  owner/mode enforcement is established by: **nothing found** here.
- **Establishes:** A read-only handle exists after a private regular file check.
- **Depended on by:** Handle revalidation and content read.

```ts
// L48-L54
const afterOpen = await handle.stat();
validateMetadata(afterOpen, path, policy);
if (beforeOpen.dev !== afterOpen.dev || beforeOpen.ino !== afterOpen.ino) throw ...;
return await handle.readFile("utf8");
```

- **What:** Repeats type/size/mode/UID policy on the opened file and compares
  device/inode to the path-level object before reading.
- **Why here:** The returned bytes must come from the same object whose metadata
  passed the initial check.
- **Assumes:** Device/inode identity semantics on the target platform.
  Established by: the host `lstat`/file-handle `stat` contract.
- **Establishes:** Returned bytes came from the validated opened object within
  the configured size limit.
- **Depended on by:** Payer config parsing, wallet-state parsing, and secret
  format validation.

```ts
// L55-L57
} finally {
  await handle.close();
}
```

- **What:** Closes the descriptor on every post-open path.
- **Establishes:** No intentionally leaked open file descriptor.

---

**Cross-Function Dependencies:**

- Callee `assertOwnerOnlyRegularFile` / `validateMetadata` (internal, L9-L39):
  regular/non-symlink, size, mode, and UID policy.
- Caller `readSecret` then normalizes and validates exact DB-key/mnemonic/EVM-key
  grammar (`tools/ppops-payer/src/security/secrets.ts:L28-L52`).
- Caller payer `loadConfig` parses strict JSON/profile/path separation
  (`tools/ppops-payer/src/config.ts:L124-L137`).
- Caller `PayerRailgunEngine.loadOrCreateWallet` parses strict wallet-state JSON
  (`tools/ppops-payer/src/railgun/engine.ts:L267-L305`).
- A mirrored root helper implements the same file policy at
  `src/security/private-file.ts:L1-L58`; the trust-domain check prevents source
  imports across package boundaries, so the code is duplicated rather than
  shared at runtime.

**Open Questions:**

- Parent-directory access/ownership policy is operator-controlled.
- Runtime memory erasure after use is not implemented by JavaScript strings.
