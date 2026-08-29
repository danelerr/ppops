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
import {
  captureMainnetGateSnapshot,
  replayConfirmedWebhookForGate,
  signMainnetGateReport,
  verifySignedMainnetGateReport,
  verifyMainnetGateSnapshots,
  type MainnetGatePhase,
} from "./pilot/mainnet-gate.js";
import { PPOpsRuntime } from "./runtime.js";
import { RpcQuorum } from "./railgun/rpc-quorum.js";
import { preflightPPOINodes } from "./railgun/ppoi-preflight.js";
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
    --token-decimals N --rpc-url URL --rpc-url URL --poi-node URL [--config PATH]
  ppops serve [--config PATH]
  ppops scan-once [--config PATH]
  ppops descriptor-verify --file PATH --expected-signer ADDRESS
  ppops backup --output NEW_DIRECTORY [--include-secrets] [--config PATH]
  ppops restore --input BACKUP_DIRECTORY [--force] [--config PATH]
  ppops config-validate [--config PATH]
  ppops preflight [--config PATH]
  ppops mainnet-gate-replay --intent-id ID [--base-url URL] [--config PATH]
  ppops mainnet-gate-snapshot --phase before|restart|restore --intent-id ID \\
    --expected-signer ADDRESS --output NEW_FILE [--base-url URL] \\
    [--receiver-stats-url URL] [--config PATH]
  ppops mainnet-gate-verify --before FILE --restart FILE --restore FILE \\
    --output NEW_FILE [--config PATH]
  ppops mainnet-gate-report-verify --file FILE --expected-signer ADDRESS

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

const writeNewJson = async (path: string, value: unknown): Promise<void> => {
  const output = resolve(path);
  await ensureMissing(output);
  await mkdir(dirname(output), { recursive: true, mode: 0o700 });
  await writeFile(output, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
    flag: "wx",
  });
};

const rpcQuorumFor = (config: PPOpsConfig): RpcQuorum =>
  new RpcQuorum({
    chainId: config.network.chainId,
    rpcUrls: config.network.rpcUrls,
    timeoutMs: config.scanner.rpcTimeoutMs,
    maxBlockLag: config.scanner.maxRpcBlockLag,
  });

const preflightConfig = async (config: PPOpsConfig): Promise<{
  rpcProviderCount: number;
  ppoiConfiguredNodeCount: number;
  ppoiHealthyNodeCount: number;
  latestBlock: number;
  finalizedBlock?: number;
  finalityMode: "finalized" | "confirmations";
}> => {
  const rpc = rpcQuorumFor(config);
  try {
    const context = await rpc.chainContext(
      config.network.finality.mode === "finalized",
    );
    const ppoi = await preflightPPOINodes(
      config.scanner.poiNodeUrls,
      config.scanner.rpcTimeoutMs,
    );
    return {
      rpcProviderCount: config.network.rpcUrls.length,
      ppoiConfiguredNodeCount: ppoi.configuredNodeCount,
      ppoiHealthyNodeCount: ppoi.healthyNodeCount,
      latestBlock: context.latestBlock,
      ...(context.finalizedBlock === undefined
        ? {}
        : { finalizedBlock: context.finalizedBlock }),
      finalityMode: config.network.finality.mode,
    };
  } finally {
    await rpc.close();
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
    "finality-mode",
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
  const finalityMode = one(options, "finality-mode", {
    defaultValue: network.chain.id === 42_161 ? "finalized" : "confirmations",
  });
  if (finalityMode !== "finalized" && finalityMode !== "confirmations") {
    throw new Error("--finality-mode must be finalized or confirmations");
  }
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
      finality:
        finalityMode === "finalized"
          ? { mode: "finalized" }
          : { mode: "confirmations", confirmations },
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
      rpcTimeoutMs: 20_000,
      maxRpcBlockLag: 5,
      finalizedRecheckSeconds: 604_800,
      scanStallThresholdMs: 1_200_000,
      maxScanStalenessMs: 900_000,
    },
    ...(webhookUrl
      ? {
          webhook: {
            url: webhookUrl,
            keyId: "v1",
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
          tokenSymbol: config.network.tokenSymbol,
          tokenDecimals: config.network.tokenDecimals,
          finalityMode: config.network.finality.mode,
          rpcProviderCount: config.network.rpcUrls.length,
          poiConfigured: config.scanner.poiNodeUrls.length > 0,
          serverHost: config.server.host,
        })}\n`,
      );
      break;
    }
    case "preflight": {
      assertAllowed(options, ["config"]);
      const config = await loadConfig(configPathFor(options));
      const result = await preflightConfig(config);
      process.stdout.write(
        `${JSON.stringify({
          ok: true,
          chainId: config.network.chainId,
          ...result,
        })}\n`,
      );
      break;
    }
    case "mainnet-gate-replay": {
      assertAllowed(options, ["config", "base-url", "intent-id"]);
      const config = await loadConfig(configPathFor(options));
      if (!config.webhook || !config.secrets.webhookHmacKeyFile) {
        throw new Error("Mainnet gate replay requires a configured webhook");
      }
      const [apiToken, webhookHmacKeyHex] = await Promise.all([
        readSecret(config.secrets.apiTokenFile, "api-token"),
        readSecret(config.secrets.webhookHmacKeyFile, "webhook-hmac-key"),
      ]);
      const result = await replayConfirmedWebhookForGate({
        baseUrl:
          one(options, "base-url", {
            defaultValue: `http://127.0.0.1:${config.server.port}`,
          }) ?? "",
        webhookUrl: config.webhook.url,
        apiToken,
        webhookHmacKeyHex,
        keyId: config.webhook.keyId ?? "v1",
        intentId: one(options, "intent-id", { required: true }) ?? "",
        timeoutMs: config.webhook.timeoutMs,
      });
      process.stdout.write(`${JSON.stringify(result)}\n`);
      break;
    }
    case "mainnet-gate-snapshot": {
      assertAllowed(options, [
        "config",
        "phase",
        "base-url",
        "intent-id",
        "expected-signer",
        "receiver-stats-url",
        "output",
      ]);
      const config = await loadConfig(configPathFor(options));
      if (!config.webhook) {
        throw new Error("Mainnet gate snapshot requires a configured webhook");
      }
      const preflight = await preflightConfig(config);
      if (preflight.finalizedBlock === undefined) {
        throw new Error("Mainnet gate requires finalized block preflight evidence");
      }
      const finalizedBlock = preflight.finalizedBlock;
      const apiToken = await readSecret(config.secrets.apiTokenFile, "api-token");
      const webhookOrigin = new URL(config.webhook.url).origin;
      const snapshot = await (async () => {
        const rpcQuorum = rpcQuorumFor(config);
        try {
          return await captureMainnetGateSnapshot({
            phase: (one(options, "phase", { required: true }) ?? "") as MainnetGatePhase,
            baseUrl:
              one(options, "base-url", {
                defaultValue: `http://127.0.0.1:${config.server.port}`,
              }) ?? "",
            receiverStatsUrl:
              one(options, "receiver-stats-url", {
                defaultValue: `${webhookOrigin}/stats`,
              }) ?? "",
            apiToken,
            intentId: one(options, "intent-id", { required: true }) ?? "",
            expectedSigner: one(options, "expected-signer", { required: true }) ?? "",
            preflight: {
              rpcProviderCount: preflight.rpcProviderCount,
              ppoiConfiguredNodeCount: preflight.ppoiConfiguredNodeCount,
              ppoiHealthyNodeCount: preflight.ppoiHealthyNodeCount,
              latestBlock: preflight.latestBlock,
              finalizedBlock,
            },
            rpcQuorum,
            timeoutMs: config.scanner.rpcTimeoutMs,
          });
        } finally {
          await rpcQuorum.close();
        }
      })();
      const output = one(options, "output", { required: true }) ?? "";
      await writeNewJson(output, snapshot);
      process.stdout.write(
        `${JSON.stringify({ ok: true, phase: snapshot.phase, result: snapshot.result, output: resolve(output) })}\n`,
      );
      break;
    }
    case "mainnet-gate-verify": {
      assertAllowed(options, ["config", "before", "restart", "restore", "output"]);
      const config = await loadConfig(configPathFor(options));
      const [apiToken, merchantPrivateKey] = await Promise.all([
        readSecret(config.secrets.apiTokenFile, "api-token"),
        readSecret(config.secrets.merchantSigningKeyFile, "merchant-private-key"),
      ]);
      const readJson = async (name: "before" | "restart" | "restore") =>
        JSON.parse(
          await readFile(resolve(one(options, name, { required: true }) ?? ""), "utf8"),
        ) as unknown;
      const [before, restart, restore] = await Promise.all([
        readJson("before"),
        readJson("restart"),
        readJson("restore"),
      ]);
      const unsignedReport = verifyMainnetGateSnapshots({
        before,
        restart,
        restore,
        apiToken,
      });
      const report = await signMainnetGateReport(unsignedReport, merchantPrivateKey);
      const output = one(options, "output", { required: true }) ?? "";
      await writeNewJson(output, report);
      process.stdout.write(
        `${JSON.stringify({ ok: true, result: report.result, output: resolve(output) })}\n`,
      );
      break;
    }
    case "mainnet-gate-report-verify": {
      assertAllowed(options, ["file", "expected-signer"]);
      const file = resolve(one(options, "file", { required: true }) ?? "");
      const expectedSigner = one(options, "expected-signer", { required: true }) ?? "";
      const report = verifySignedMainnetGateReport(
        JSON.parse(await readFile(file, "utf8")) as unknown,
        expectedSigner,
      );
      process.stdout.write(
        `${JSON.stringify({
          ok: true,
          result: report.result,
          signatureValid: true,
          signer: report.reportSignature.signer,
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
