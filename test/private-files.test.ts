import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";
import { readSecret } from "../src/security/secrets.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true })));
});

const configFixture = () => ({
  schemaVersion: 1,
  server: { host: "127.0.0.1", port: 8787, allowRemote: false },
  network: {
    railgunNetworkName: "Ethereum_Sepolia",
    chainId: 11_155_111,
    tokenAddress: "0x00000000000000000000000000000000000000A1",
    tokenSymbol: "TESTUSD",
    tokenDecimals: 6,
    rpcUrls: ["https://rpc.example"],
    deploymentBlock: 5_784_866,
    finality: { mode: "confirmations", confirmations: 12 },
  },
  storage: {
    sqlitePath: "./data/ppops.sqlite",
    railgunDbPath: "./data/railgun-db",
    artifactsPath: "./data/artifacts",
    walletStatePath: "./data/wallet.json",
  },
  secrets: {
    apiTokenFile: "./secrets/api-token",
    merchantSigningKeyFile: "./secrets/merchant-key",
    railgunDbEncryptionKeyFile: "./secrets/db-key",
    viewingKeyFile: "./secrets/viewing-key",
  },
  scanner: {
    intervalMs: 30_000,
    poiNodeUrls: ["https://poi.example"],
    providerPollingIntervalMs: 10_000,
  },
});

describe("owner-only local file boundary", () => {
  it("reads valid private config and secret files", async () => {
    const root = await mkdtemp(join(tmpdir(), "ppops-private-files-"));
    roots.push(root);
    const configPath = join(root, "ppops.config.json");
    const secretPath = join(root, "api-token");
    await writeFile(configPath, JSON.stringify(configFixture()), { mode: 0o600 });
    await writeFile(secretPath, `${"A".repeat(43)}\n`, { mode: 0o600 });

    await expect(loadConfig(configPath)).resolves.toMatchObject({ schemaVersion: 1 });
    await expect(readSecret(secretPath, "api-token")).resolves.toBe("A".repeat(43));
  });

  it("rejects group-readable config and secret files", async () => {
    if (process.platform === "win32") return;
    const root = await mkdtemp(join(tmpdir(), "ppops-private-files-"));
    roots.push(root);
    const configPath = join(root, "ppops.config.json");
    const secretPath = join(root, "api-token");
    await writeFile(configPath, JSON.stringify(configFixture()), { mode: 0o600 });
    await writeFile(secretPath, `${"A".repeat(43)}\n`, { mode: 0o600 });
    await chmod(configPath, 0o640);
    await chmod(secretPath, 0o640);

    await expect(loadConfig(configPath)).rejects.toThrow(/group or others/);
    await expect(readSecret(secretPath, "api-token")).rejects.toThrow(/group or others/);
  });

  it("rejects symlinked and unexpectedly large files", async () => {
    if (process.platform === "win32") return;
    const root = await mkdtemp(join(tmpdir(), "ppops-private-files-"));
    roots.push(root);
    const target = join(root, "target");
    const linked = join(root, "linked");
    const oversized = join(root, "oversized");
    await writeFile(target, `${"ab".repeat(32)}\n`, { mode: 0o600 });
    await symlink(target, linked);
    await writeFile(oversized, "x".repeat(4_097), { mode: 0o600 });

    await expect(readSecret(linked, "railgun-db-encryption-key")).rejects.toThrow(
      /non-symlink/,
    );
    await expect(readSecret(oversized, "viewing-key")).rejects.toThrow(/4096-byte/);
  });
});
