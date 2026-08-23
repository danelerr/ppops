#!/usr/bin/env node

import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { NETWORK_CONFIG, NetworkName } from "@railgun-community/shared-models";
import { Wallet, getAddress } from "ethers";

import { PPOpsDaemon } from "./api/server.js";
import { createBackup, restoreBackup } from "./backup.js";
import { PPOpsConfigSchema, loadConfig, type PPOpsConfig } from "./config.js";
import { PPOpsRuntime } from "./runtime.js";
import {
  parseSignedDescriptor,
  verifySignedDescriptor,
} from "./security/descriptor.js";
import {
  generateApiToken,
  generateHexKey,
  generatePrivateKey,
  readSecret,
  writeNewSecret,
} from "./security/secrets.js";

const HELP = `PPOps v0.1.0-beta.0

Usage:
  ppops init --viewing-key-file PATH --token-address ADDRESS --token-symbol SYMBOL \\
    --token-decimals N --rpc-url URL --poi-node URL [--config PATH]
  ppops serve [--config PATH]
  ppops scan-once [--config PATH]
  ppops descriptor-verify --file PATH --expected-signer ADDRESS
  ppops backup --output NEW_DIRECTORY [--include-secrets] [--config PATH]
  ppops restore --input BACKUP_DIRECTORY [--force] [--config PATH]
  ppops config-validate [--config PATH]

Security:
  PPOps accepts a RAILGUN shareable viewing key, never a spending key or mnemonic.
  --include-secrets creates a sensitive recovery bundle; protect it like financial data.
`;

type ParsedOptions = Map<string, string[]>;

const parseOptions = (args: string[]): ParsedOptions => {
  const options = new Map<string, string[]>();
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (!option?.startsWith("--")) throw new Error(`Unexpected argument: ${option}`);
    const name = option.slice(2);
    const following = args[index + 1];
    const value = !following || following.startsWith("--") ? "true" : following;
    if (value !== "true") index += 1;
    options.set(name, [...(options.get(name) ?? []), value]);
  }
  return options;
};

const one = (
  options: ParsedOptions,
  name: string,
  settings: { required?: boolean; defaultValue?: string } = {},
): string | undefined => {
  const values = options.get(name);
  if (values && values.length > 1) throw new Error(`--${name} may be specified only once`);
  const value = values?.[0] ?? settings.defaultValue;
  if (settings.required && !value) throw new Error(`Missing required option --${name}`);
  return value;
};

const many = (options: ParsedOptions, name: string, required = false): string[] => {
  const values = options.get(name) ?? [];
  if (required && values.length === 0) throw new Error(`Missing required option --${name}`);
  return values;
};

const flag = (options: ParsedOptions, name: string): boolean => {
  const value = one(options, name);
  if (value === undefined) return false;
  if (value !== "true") throw new Error(`--${name} does not take a value`);
  return true;
};

const assertAllowed = (options: ParsedOptions, allowed: string[]): void => {
  const allowedSet = new Set(allowed);
  for (const name of options.keys()) {
    if (!allowedSet.has(name)) throw new Error(`Unsupported option --${name}`);
  }
};

const configPathFor = (options: ParsedOptions): string =>
  resolve(one(options, "config", { defaultValue: "ppops.config.json" }) ?? "");

const integerOption = (
  options: ParsedOptions,
  name: string,
  settings: { required?: boolean; defaultValue?: number } = {},
): number => {
  const raw = one(options, name, {
    required: settings.required,
    ...(settings.defaultValue === undefined
      ? {}
      : { defaultValue: settings.defaultValue.toString() }),
  });
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`--${name} must be a non-negative integer`);
  }
  return value;
};

const ensureMissing = async (path: string): Promise<void> => {
  try {
    await access(path, constants.F_OK);
    throw new Error(`Refusing to overwrite existing path: ${path}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
};

const init = async (options: ParsedOptions): Promise<void> => {
  assertAllowed(options, [
    "config",
    "viewing-key-file",
    "network",
    "token-address",
    "token-symbol",
    "token-decimals",
    "rpc-url",
    "poi-node",
    "confirmations",
    "port",
    "scan-interval-ms",
    "webhook-url",
  ]);
  const configPath = configPathFor(options);
  await ensureMissing(configPath);
  const viewingKeyFile = resolve(
    one(options, "viewing-key-file", { required: true }) ?? "",
  );
  await readSecret(viewingKeyFile, "viewing-key");
  const networkNameValue = one(options, "network", {
    defaultValue: NetworkName.EthereumSepolia,
  });
  if (!Object.values(NetworkName).includes(networkNameValue as NetworkName)) {
    throw new Error(`Unsupported RAILGUN network: ${networkNameValue}`);
  }
  const networkName = networkNameValue as NetworkName;
  const network = NETWORK_CONFIG[networkName];
  const tokenAddress = getAddress(
    one(options, "token-address", { required: true }) ?? "",
  );
  const tokenSymbol = one(options, "token-symbol", { required: true }) ?? "";
  const tokenDecimals = integerOption(options, "token-decimals", { required: true });
  const rpcUrls = many(options, "rpc-url", true);
  const poiNodeUrls = many(options, "poi-node", true);
  const confirmations = integerOption(options, "confirmations", { defaultValue: 12 });
  if (confirmations < 1) throw new Error("--confirmations must be at least 1");
  const configRoot = dirname(configPath);
  const secretsRoot = resolve(configRoot, "secrets");
  const apiTokenFile = resolve(secretsRoot, "api-token");
  const merchantSigningKeyFile = resolve(secretsRoot, "merchant-signing-key");
  const railgunDbEncryptionKeyFile = resolve(secretsRoot, "railgun-db-encryption-key");
  const webhookUrl = one(options, "webhook-url");
  const webhookHmacKeyFile = resolve(secretsRoot, "webhook-hmac-key");

  const config: PPOpsConfig = PPOpsConfigSchema.parse({
    schemaVersion: 1,
    server: {
      host: "127.0.0.1",
      port: integerOption(options, "port", { defaultValue: 8787 }),
      allowRemote: false,
    },
    network: {
      railgunNetworkName: networkName,
      chainId: network.chain.id,
      tokenAddress,
      tokenSymbol,
      tokenDecimals,
      rpcUrls,
      deploymentBlock: network.deploymentBlock,
      finality: { mode: "confirmations", confirmations },
    },
    storage: {
      sqlitePath: "./data/ppops.sqlite",
      railgunDbPath: "./data/railgun-db",
      artifactsPath: "./data/artifacts",
      walletStatePath: "./data/railgun-wallet.json",
    },
    secrets: {
      apiTokenFile: "./secrets/api-token",
      merchantSigningKeyFile: "./secrets/merchant-signing-key",
      railgunDbEncryptionKeyFile: "./secrets/railgun-db-encryption-key",
      viewingKeyFile,
      ...(webhookUrl ? { webhookHmacKeyFile: "./secrets/webhook-hmac-key" } : {}),
    },
    scanner: {
      intervalMs: integerOption(options, "scan-interval-ms", { defaultValue: 30_000 }),
      poiNodeUrls,
      providerPollingIntervalMs: 10_000,
    },
    ...(webhookUrl
      ? {
          webhook: {
            url: webhookUrl,
            timeoutMs: 10_000,
            maxAttempts: 12,
            baseRetryMs: 5_000,
            maxRetryMs: 3_600_000,
          },
        }
      : {}),
  });

  const privateKey = generatePrivateKey();
  await Promise.all([
    ensureMissing(apiTokenFile),
    ensureMissing(merchantSigningKeyFile),
    ensureMissing(railgunDbEncryptionKeyFile),
    ...(webhookUrl ? [ensureMissing(webhookHmacKeyFile)] : []),
  ]);
  await mkdir(configRoot, { recursive: true, mode: 0o700 });
  await writeNewSecret(apiTokenFile, generateApiToken());
  await writeNewSecret(merchantSigningKeyFile, privateKey);
  await writeNewSecret(railgunDbEncryptionKeyFile, generateHexKey());
  if (webhookUrl) await writeNewSecret(webhookHmacKeyFile, generateHexKey());
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, {
    mode: 0o600,
    flag: "wx",
  });
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      configPath,
      merchantSigner: new Wallet(privateKey).address,
      apiTokenFile,
      viewingKeyFile,
      spendingMaterialAccepted: false,
      next: `ppops serve --config ${configPath}`,
    })}\n`,
  );
};

const serve = async (options: ParsedOptions): Promise<void> => {
  assertAllowed(options, ["config"]);
  const runtime = await PPOpsRuntime.create(configPathFor(options));
  const daemon = new PPOpsDaemon(runtime);
  try {
    daemon.start();
    const signal = new Promise<void>((resolveSignal) => {
      process.once("SIGINT", () => resolveSignal());
      process.once("SIGTERM", () => resolveSignal());
    });
    await Promise.race([signal, daemon.failure]);
  } finally {
    await daemon.stop();
  }
};

const scanOnce = async (options: ParsedOptions): Promise<void> => {
  assertAllowed(options, ["config"]);
  const runtime = await PPOpsRuntime.create(configPathFor(options));
  try {
    const result = await runtime.scanOnce();
    process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`);
  } finally {
    await runtime.stop();
  }
};

const descriptorVerify = async (options: ParsedOptions): Promise<void> => {
  assertAllowed(options, ["file", "expected-signer"]);
  const file = resolve(one(options, "file", { required: true }) ?? "");
  const expectedSigner = one(options, "expected-signer", { required: true }) ?? "";
  const descriptor = parseSignedDescriptor(JSON.parse(await readFile(file, "utf8")) as unknown);
  const recoveredSigner = verifySignedDescriptor(descriptor, expectedSigner);
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      signatureValid: true,
      expired: descriptor.expiresAt <= Math.floor(Date.now() / 1_000),
      recoveredSigner,
      expectedSigner,
      note: "Signature verification does not replace checking chain, token, amount, recipient and expiry.",
    })}\n`,
  );
};

export const main = async (argv = process.argv.slice(2)): Promise<void> => {
  const command = argv[0];
  if (!command || command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(HELP);
    return;
  }
  const options = parseOptions(argv.slice(1));
  switch (command) {
    case "init":
      await init(options);
      break;
    case "serve":
      await serve(options);
      break;
    case "scan-once":
      await scanOnce(options);
      break;
    case "descriptor-verify":
      await descriptorVerify(options);
      break;
    case "backup": {
      assertAllowed(options, ["config", "output", "include-secrets"]);
      const outputPath = one(options, "output", { required: true }) ?? "";
      const result = await createBackup({
        configPath: configPathFor(options),
        outputPath,
        includeSecrets: flag(options, "include-secrets"),
      });
      process.stdout.write(
        `${JSON.stringify({
          ok: true,
          path: result.path,
          containsSecrets: result.manifest.containsSecrets,
        })}\n`,
      );
      break;
    }
    case "restore": {
      assertAllowed(options, ["config", "input", "force"]);
      const backupPath = one(options, "input", { required: true }) ?? "";
      const result = await restoreBackup({
        configPath: configPathFor(options),
        backupPath,
        force: flag(options, "force"),
      });
      process.stdout.write(
        `${JSON.stringify({ ok: true, restoredFrom: result.restoredFrom })}\n`,
      );
      break;
    }
    case "config-validate": {
      assertAllowed(options, ["config"]);
      const config = await loadConfig(configPathFor(options));
      process.stdout.write(
        `${JSON.stringify({
          ok: true,
          chainId: config.network.chainId,
          tokenAddress: getAddress(config.network.tokenAddress),
          serverHost: config.server.host,
        })}\n`,
      );
      break;
    }
    default:
      throw new Error(`Unknown command: ${command}`);
  }
};

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (invokedPath === import.meta.url) {
  main()
    .then(() => {
      if (process.argv[2] === "serve" || process.argv[2] === "scan-once") {
        process.exit(0);
      }
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Unknown PPOps failure";
      process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`, () => {
        process.exit(1);
      });
    });
}
