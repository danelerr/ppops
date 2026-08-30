import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  copyFile,
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";

import Database from "better-sqlite3";
import { getAddress, Wallet } from "ethers";
import { z } from "zod";

import { loadConfig, type PPOpsConfig } from "./config.js";
import { PPOpsDatabase } from "./db/database.js";
import { readSecret } from "./security/secrets.js";
import { RuntimeLock, runtimeLockPath } from "./security/runtime-lock.js";

const FileEntrySchema = z.object({
  path: z
    .string()
    .min(1)
    .refine(
      (path) => !path.startsWith("/") && !path.split(/[\\/]/).includes(".."),
      "Backup paths must remain inside the backup root",
    ),
  size: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});

const BackupManifestSchema = z.object({
  schemaVersion: z.literal(1),
  ppopsVersion: z.literal("0.1.0-beta.0"),
  createdAt: z.string(),
  containsSecrets: z.boolean(),
  network: z.object({
    railgunNetworkName: z.string(),
    chainId: z.number().int().positive(),
    tokenAddress: z.string(),
  }),
  secretFingerprints: z.object({
    viewingKey: z.string().regex(/^[0-9a-f]{64}$/),
    railgunDbEncryptionKey: z.string().regex(/^[0-9a-f]{64}$/),
    merchantSigner: z.string(),
  }),
  files: z.array(FileEntrySchema),
});

type BackupManifest = z.infer<typeof BackupManifestSchema>;

const pathExists = async (path: string): Promise<boolean> => {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
};

const sha256File = async (path: string): Promise<{ sha256: string; size: number }> => {
  const contents = await readFile(path);
  return {
    sha256: createHash("sha256").update(contents).digest("hex"),
    size: contents.length,
  };
};

const secretFingerprint = (kind: string, value: string): string =>
  createHash("sha256").update(`ppops-backup:v1:${kind}:`).update(value).digest("hex");

const listFiles = async (root: string, current = root): Promise<string[]> => {
  const entries = await readdir(current, { withFileTypes: true });
  const paths: string[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) paths.push(...(await listFiles(root, path)));
    else if (entry.isFile()) paths.push(relative(root, path));
    else throw new Error(`Backup cannot contain symbolic links or special files: ${path}`);
  }
  return paths;
};

const copyPrivateFile = async (source: string, destination: string): Promise<void> => {
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  await copyFile(source, destination);
  if (process.platform !== "win32") await chmod(destination, 0o600);
};

const copyOptionalPath = async (source: string, destination: string): Promise<boolean> => {
  if (!(await pathExists(source))) return false;
  await cp(source, destination, { recursive: true, errorOnExist: true });
  return true;
};

const readRequiredBackupSecrets = async (config: PPOpsConfig) => {
  const [viewingKey, railgunDbEncryptionKey, merchantPrivateKey] = await Promise.all([
    readSecret(config.secrets.viewingKeyFile, "viewing-key"),
    readSecret(config.secrets.railgunDbEncryptionKeyFile, "railgun-db-encryption-key"),
    readSecret(config.secrets.merchantSigningKeyFile, "merchant-private-key"),
  ]);
  return { viewingKey, railgunDbEncryptionKey, merchantPrivateKey };
};

const assertSecretIdentity = (
  secrets: Awaited<ReturnType<typeof readRequiredBackupSecrets>>,
  manifest: BackupManifest,
): void => {
  if (
    secretFingerprint("viewing-key", secrets.viewingKey) !==
      manifest.secretFingerprints.viewingKey ||
    secretFingerprint("railgun-db-encryption-key", secrets.railgunDbEncryptionKey) !==
      manifest.secretFingerprints.railgunDbEncryptionKey ||
    getAddress(new Wallet(secrets.merchantPrivateKey).address) !==
      getAddress(manifest.secretFingerprints.merchantSigner)
  ) {
    throw new Error("Backup state does not match the expected recovery secrets");
  }
};

export const createBackup = async (args: {
  configPath: string;
  outputPath: string;
  includeSecrets?: boolean;
}): Promise<{ path: string; manifest: BackupManifest }> => {
  const config = await loadConfig(args.configPath);
  await RuntimeLock.assertStopped(runtimeLockPath(config.storage.sqlitePath));
  const output = resolve(args.outputPath);
  if (await pathExists(output)) throw new Error(`Backup destination already exists: ${output}`);
  await mkdir(dirname(output), { recursive: true, mode: 0o700 });
  const staging = join(
    dirname(output),
    `.${basename(output)}.partial-${randomUUID().replaceAll("-", "")}`,
  );
  await mkdir(staging, { mode: 0o700 });

  const sqliteDestination = join(staging, "state", "ppops.sqlite");
  await mkdir(dirname(sqliteDestination), { recursive: true, mode: 0o700 });
  const sourceDatabase = new Database(config.storage.sqlitePath, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    await sourceDatabase.backup(sqliteDestination);
  } finally {
    sourceDatabase.close();
  }
  if (process.platform !== "win32") await chmod(sqliteDestination, 0o600);

  if (!(await copyOptionalPath(config.storage.railgunDbPath, join(staging, "state", "railgun-db")))) {
    throw new Error("RAILGUN database path does not exist");
  }
  await copyOptionalPath(config.storage.artifactsPath, join(staging, "state", "artifacts"));
  await copyPrivateFile(config.storage.walletStatePath, join(staging, "state", "wallet.json"));

  const requiredSecrets = await readRequiredBackupSecrets(config);
  if (args.includeSecrets) {
    await copyPrivateFile(config.secrets.apiTokenFile, join(staging, "secrets", "api-token"));
    await copyPrivateFile(
      config.secrets.merchantSigningKeyFile,
      join(staging, "secrets", "merchant-signing-key"),
    );
    await copyPrivateFile(
      config.secrets.railgunDbEncryptionKeyFile,
      join(staging, "secrets", "railgun-db-encryption-key"),
    );
    await copyPrivateFile(
      config.secrets.viewingKeyFile,
      join(staging, "secrets", "viewing-key"),
    );
    if (config.secrets.webhookHmacKeyFile) {
      await copyPrivateFile(
        config.secrets.webhookHmacKeyFile,
        join(staging, "secrets", "webhook-hmac-key"),
      );
    }
  }

  const relativeFiles = (await listFiles(staging)).filter(
    (path) => path !== "manifest.json",
  );
  const files = await Promise.all(
    relativeFiles.map(async (path) => ({ path, ...(await sha256File(join(staging, path))) })),
  );
  const manifest: BackupManifest = {
    schemaVersion: 1,
    ppopsVersion: "0.1.0-beta.0",
    createdAt: new Date().toISOString(),
    containsSecrets: args.includeSecrets === true,
    network: {
      railgunNetworkName: config.network.railgunNetworkName,
      chainId: config.network.chainId,
      tokenAddress: getAddress(config.network.tokenAddress),
    },
    secretFingerprints: {
      viewingKey: secretFingerprint("viewing-key", requiredSecrets.viewingKey),
      railgunDbEncryptionKey: secretFingerprint(
        "railgun-db-encryption-key",
        requiredSecrets.railgunDbEncryptionKey,
      ),
      merchantSigner: new Wallet(requiredSecrets.merchantPrivateKey).address,
    },
    files,
  };
  await writeFile(join(staging, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, {
    mode: 0o600,
    flag: "wx",
  });
  await rename(staging, output);
  return { path: output, manifest };
};

const verifyBackup = async (root: string): Promise<BackupManifest> => {
  const manifest = BackupManifestSchema.parse(
    JSON.parse(await readFile(join(root, "manifest.json"), "utf8")) as unknown,
  );
  const actualPaths = (await listFiles(root)).filter((path) => path !== "manifest.json");
  const expectedPaths = manifest.files.map((entry) => entry.path).sort();
  if (JSON.stringify(actualPaths.sort()) !== JSON.stringify(expectedPaths)) {
    throw new Error("Backup file list does not match its manifest inventory");
  }
  for (const expected of manifest.files) {
    const actual = await sha256File(join(root, expected.path));
    if (actual.sha256 !== expected.sha256 || actual.size !== expected.size) {
      throw new Error(`Backup integrity check failed for ${expected.path}`);
    }
  }
  return manifest;
};

const moveAsideIfNeeded = async (path: string, force: boolean, suffix: string): Promise<void> => {
  if (!(await pathExists(path))) return;
  if (!force) throw new Error(`Restore target already exists: ${path}`);
  await rename(path, `${path}.pre-restore-${suffix}`);
};

export const restoreBackup = async (args: {
  configPath: string;
  backupPath: string;
  force?: boolean;
}): Promise<{ restoredFrom: string; manifest: BackupManifest }> => {
  const config = await loadConfig(args.configPath);
  await RuntimeLock.assertStopped(runtimeLockPath(config.storage.sqlitePath));
  const backupRoot = resolve(args.backupPath);
  const manifest = await verifyBackup(backupRoot);
  if (
    manifest.network.chainId !== config.network.chainId ||
    getAddress(manifest.network.tokenAddress) !== getAddress(config.network.tokenAddress) ||
    manifest.network.railgunNetworkName !== config.network.railgunNetworkName
  ) {
    throw new Error("Backup network/token profile does not match the restore configuration");
  }

  if (manifest.containsSecrets) {
    const bundledSecrets = {
      viewingKey: await readSecret(join(backupRoot, "secrets", "viewing-key"), "viewing-key"),
      railgunDbEncryptionKey: await readSecret(
        join(backupRoot, "secrets", "railgun-db-encryption-key"),
        "railgun-db-encryption-key",
      ),
      merchantPrivateKey: await readSecret(
        join(backupRoot, "secrets", "merchant-signing-key"),
        "merchant-private-key",
      ),
    };
    assertSecretIdentity(bundledSecrets, manifest);
    const existingRequiredSecretPaths = [
      config.secrets.viewingKeyFile,
      config.secrets.railgunDbEncryptionKeyFile,
      config.secrets.merchantSigningKeyFile,
    ];
    const existing = await Promise.all(existingRequiredSecretPaths.map(pathExists));
    if (existing.some(Boolean) && !existing.every(Boolean)) {
      throw new Error("Restore configuration contains only part of the required secret set");
    }
    if (existing.every(Boolean)) {
      assertSecretIdentity(await readRequiredBackupSecrets(config), manifest);
    }
  } else {
    assertSecretIdentity(await readRequiredBackupSecrets(config), manifest);
  }

  const suffix = Date.now().toString();
  const stateTargets = [
    config.storage.sqlitePath,
    config.storage.railgunDbPath,
    config.storage.artifactsPath,
    config.storage.walletStatePath,
  ];
  const secretTargets = manifest.containsSecrets
    ? [
        config.secrets.apiTokenFile,
        config.secrets.merchantSigningKeyFile,
        config.secrets.railgunDbEncryptionKeyFile,
        config.secrets.viewingKeyFile,
        ...(config.secrets.webhookHmacKeyFile
          ? [config.secrets.webhookHmacKeyFile]
          : []),
      ]
    : [];
  for (const target of [...stateTargets, ...secretTargets]) {
    await moveAsideIfNeeded(target, args.force === true, suffix);
  }

  await copyPrivateFile(join(backupRoot, "state", "ppops.sqlite"), config.storage.sqlitePath);
  await mkdir(dirname(config.storage.railgunDbPath), { recursive: true, mode: 0o700 });
  await cp(join(backupRoot, "state", "railgun-db"), config.storage.railgunDbPath, {
    recursive: true,
    errorOnExist: true,
  });
  if (await pathExists(join(backupRoot, "state", "artifacts"))) {
    await mkdir(dirname(config.storage.artifactsPath), { recursive: true, mode: 0o700 });
    await cp(join(backupRoot, "state", "artifacts"), config.storage.artifactsPath, {
      recursive: true,
      errorOnExist: true,
    });
  }
  await copyPrivateFile(join(backupRoot, "state", "wallet.json"), config.storage.walletStatePath);

  if (manifest.containsSecrets) {
    await copyPrivateFile(join(backupRoot, "secrets", "api-token"), config.secrets.apiTokenFile);
    await copyPrivateFile(
      join(backupRoot, "secrets", "merchant-signing-key"),
      config.secrets.merchantSigningKeyFile,
    );
    await copyPrivateFile(
      join(backupRoot, "secrets", "railgun-db-encryption-key"),
      config.secrets.railgunDbEncryptionKeyFile,
    );
    await copyPrivateFile(
      join(backupRoot, "secrets", "viewing-key"),
      config.secrets.viewingKeyFile,
    );
    if (
      config.secrets.webhookHmacKeyFile &&
      (await pathExists(join(backupRoot, "secrets", "webhook-hmac-key")))
    ) {
      await copyPrivateFile(
        join(backupRoot, "secrets", "webhook-hmac-key"),
        config.secrets.webhookHmacKeyFile,
      );
    }
  }

  assertSecretIdentity(await readRequiredBackupSecrets(config), manifest);
  const validationDatabase = new PPOpsDatabase(config.storage.sqlitePath);
  validationDatabase.close();
  return { restoredFrom: backupRoot, manifest };
};
