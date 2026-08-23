import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Wallet } from "ethers";
import { afterEach, describe, expect, it } from "vitest";

import { createBackup, restoreBackup } from "../src/backup.js";
import type { PPOpsConfig } from "../src/config.js";
import { PPOpsDatabase } from "../src/db/database.js";
import { IntentService } from "../src/intents/service.js";
import { RuntimeLock, runtimeLockPath } from "../src/security/runtime-lock.js";

const roots: string[] = [];

const rootForTest = (): string => {
  const root = mkdtempSync(join(tmpdir(), "ppops-backup-test-"));
  roots.push(root);
  return root;
};

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

const secret = (path: string, value: string): void => {
  mkdirSync(join(path, ".."), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${value}\n`, { mode: 0o600 });
  if (process.platform !== "win32") chmodSync(path, 0o600);
};

const configAt = (root: string, sourceSecrets?: string): { config: PPOpsConfig; path: string } => {
  const secretsRoot = sourceSecrets ?? join(root, "secrets");
  const config: PPOpsConfig = {
    schemaVersion: 1,
    server: { host: "127.0.0.1", port: 8787, allowRemote: false },
    network: {
      railgunNetworkName: "Ethereum_Sepolia",
      chainId: 11_155_111,
      tokenAddress: "0x00000000000000000000000000000000000000A1",
      tokenSymbol: "TESTUSD",
      tokenDecimals: 6,
      rpcUrls: ["https://rpc.example"],
      deploymentBlock: 1,
      finality: { mode: "confirmations", confirmations: 3 },
    },
    storage: {
      sqlitePath: join(root, "data", "ppops.sqlite"),
      railgunDbPath: join(root, "data", "railgun-db"),
      artifactsPath: join(root, "data", "artifacts"),
      walletStatePath: join(root, "data", "wallet.json"),
    },
    secrets: {
      apiTokenFile: join(secretsRoot, "api-token"),
      merchantSigningKeyFile: join(secretsRoot, "merchant-key"),
      railgunDbEncryptionKeyFile: join(secretsRoot, "railgun-db-key"),
      viewingKeyFile: join(secretsRoot, "viewing-key"),
    },
    scanner: {
      intervalMs: 30_000,
      poiNodeUrls: ["https://poi.example"],
      providerPollingIntervalMs: 10_000,
      rpcTimeoutMs: 20_000,
      maxRpcBlockLag: 5,
      finalizedRecheckSeconds: 604_800,
    },
  };
  mkdirSync(root, { recursive: true });
  const path = join(root, "ppops.config.json");
  writeFileSync(path, JSON.stringify(config));
  return { config, path };
};

describe("backup and restore", () => {
  it("restores SQLite, encrypted RAILGUN state and recovery secrets", async () => {
    const sourceRoot = rootForTest();
    const source = configAt(sourceRoot);
    const merchant = Wallet.createRandom();
    secret(source.config.secrets.apiTokenFile, "A".repeat(43));
    secret(source.config.secrets.merchantSigningKeyFile, merchant.privateKey);
    secret(source.config.secrets.railgunDbEncryptionKeyFile, "ab".repeat(32));
    secret(source.config.secrets.viewingKeyFile, `0zk-viewing-${"c".repeat(64)}`);
    mkdirSync(source.config.storage.railgunDbPath, { recursive: true, mode: 0o700 });
    mkdirSync(source.config.storage.artifactsPath, { recursive: true, mode: 0o700 });
    mkdirSync(join(sourceRoot, "data"), { recursive: true, mode: 0o700 });
    writeFileSync(join(source.config.storage.railgunDbPath, "CURRENT"), "MANIFEST-000001\n");
    writeFileSync(join(source.config.storage.artifactsPath, "artifact.bin"), "artifact");
    writeFileSync(
      source.config.storage.walletStatePath,
      JSON.stringify({ schemaVersion: 1, walletID: "wallet", railgunAddress: "0zk" }),
      { mode: 0o600 },
    );

    const database = new PPOpsDatabase(source.config.storage.sqlitePath);
    const intents = new IntentService(
      database,
      source.config.network,
      "0zk-test-receiver",
      merchant.privateKey,
    );
    const intent = await intents.create(
      { externalReference: "INV-BACKUP", amountAtomic: "42", expiresAt: 2_000 },
      1_000,
    );
    database.close();

    const backupPath = join(sourceRoot, "backup-1");
    const backup = await createBackup({
      configPath: source.path,
      outputPath: backupPath,
      includeSecrets: true,
    });
    expect(backup.manifest.containsSecrets).toBe(true);

    const restoreRoot = rootForTest();
    const restore = configAt(restoreRoot);
    await restoreBackup({ configPath: restore.path, backupPath });

    const restoredDatabase = new PPOpsDatabase(restore.config.storage.sqlitePath);
    expect(restoredDatabase.getIntent(intent.id)?.externalReference).toBe("INV-BACKUP");
    restoredDatabase.close();
    expect(readFileSync(join(restore.config.storage.railgunDbPath, "CURRENT"), "utf8"))
      .toBe("MANIFEST-000001\n");
    expect(readFileSync(restore.config.secrets.merchantSigningKeyFile, "utf8").trim())
      .toBe(merchant.privateKey);
  });

  it("refuses an online backup while the runtime lock is held", async () => {
    const root = rootForTest();
    const { config, path } = configAt(root);
    const lock = await RuntimeLock.acquire(runtimeLockPath(config.storage.sqlitePath));
    await expect(
      createBackup({ configPath: path, outputPath: join(root, "backup") }),
    ).rejects.toThrow(/must be stopped/);
    await lock.release();
  });
});
