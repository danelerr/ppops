import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Wallet } from "ethers";
import { afterEach, describe, expect, it } from "vitest";

import { readSecret } from "../src/security/secrets.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true })));
});

describe("local spending-secret boundary", () => {
  it("reads valid owner-only files without returning them in errors", async () => {
    const root = await mkdtemp(join(tmpdir(), "ppops-payer-secrets-"));
    roots.push(root);
    const wallet = Wallet.createRandom();
    const mnemonicPath = join(root, "mnemonic");
    const keyPath = join(root, "key");
    await writeFile(mnemonicPath, `${wallet.mnemonic?.phrase}\n`, { mode: 0o600 });
    await writeFile(keyPath, `${wallet.privateKey}\n`, { mode: 0o600 });

    expect(await readSecret(mnemonicPath, "mnemonic")).toBe(wallet.mnemonic?.phrase);
    expect(await readSecret(keyPath, "evm-private-key")).toBe(wallet.privateKey);
  });

  it("rejects group-readable and symlinked secrets", async () => {
    if (process.platform === "win32") return;
    const root = await mkdtemp(join(tmpdir(), "ppops-payer-secrets-"));
    roots.push(root);
    const target = join(root, "target");
    const linked = join(root, "linked");
    await writeFile(target, `${"ab".repeat(32)}\n`, { mode: 0o600 });
    await chmod(target, 0o640);
    await expect(readSecret(target, "db-encryption-key")).rejects.toThrow(/group or others/);
    await chmod(target, 0o600);
    await symlink(target, linked);
    await expect(readSecret(linked, "db-encryption-key")).rejects.toThrow(/non-symlink/);
  });
});
