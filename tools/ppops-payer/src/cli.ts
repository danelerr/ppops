#!/usr/bin/env node

import { constants } from "node:fs";
import {
  access,
  chmod,
  mkdir,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { z } from "zod";

import { loadConfig, PayerConfigSchema, type PayerConfig } from "./config.js";
import {
  PAYER_CHAIN_ID,
  PAYER_DEPLOYMENT_BLOCK,
  PAYER_NETWORK,
  PAYER_TOKEN_ADDRESS,
  PAYER_TOKEN_DECIMALS,
  PAYER_TOKEN_SYMBOL,
} from "./constants.js";
import { SafeFailure, safeFailureResult } from "./events.js";
import { assertExpectedPayerAddress } from "./execution-guards.js";
import { PayerRailgunEngine } from "./railgun/engine.js";
import { sendSelfSignedTransfer } from "./railgun/self-signed-transfer.js";
import {
  loadPaymentRequest,
  verifyPaymentRequest,
  type PaymentRequest,
} from "./request.js";
import {
  generateDbEncryptionKey,
  readSecret,
  writeNewSecret,
} from "./security/secrets.js";
import { readOwnerOnlyFile } from "./security/private-file.js";
import {
  PayerRuntimeLock,
  payerRuntimeLockPath,
} from "./security/runtime-lock.js";
import {
  SubmissionJournal,
  submissionJournalPath,
} from "./security/submission-journal.js";

process.umask(0o077);

const USAGE = `ppops-payer

Commands:
  ppops-payer init --config PATH --creation-block BLOCK \\
    [--from-ppops-config PATH | --rpc-url URL --rpc-url URL --poi-node URL] \\
    [--mnemonic-file PATH] [--self-signing-key-file PATH]

  ppops-payer config-validate --config PATH
  ppops-payer secrets-check --config PATH
  ppops-payer request-verify --request URL_OR_PATH --expected-signer ADDRESS
  ppops-payer sync --config PATH
  ppops-payer submission-status --config PATH --intent-id pi_ID
  ppops-payer pay-self-signed --config PATH --request URL_OR_PATH \\
    --expected-signer ADDRESS --max-amount-atomic AMOUNT \\
    --expected-payer 0zk_ADDRESS --expected-self-signer EVM_ADDRESS \\
    --max-gas-cost-wei WEI --confirm-intent pi_ID

Secrets are read only from private files. Never pass a mnemonic or private key
as a CLI argument. pay-self-signed is an explicit diagnostic Gate A and links
the public self-signing address to the otherwise encrypted transaction.
`;

type ParsedOptions = Map<string, string[]>;

const parseOptions = (args: string[]): ParsedOptions => {
  const options: ParsedOptions = new Map();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument?.startsWith("--")) throw new Error(`Unexpected argument: ${argument ?? ""}`);
    const key = argument.slice(2);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`--${key} requires a value`);
    options.set(key, [...(options.get(key) ?? []), value]);
    index += 1;
  }
  return options;
};

const assertAllowed = (options: ParsedOptions, allowed: string[]): void => {
  for (const key of options.keys()) {
    if (!allowed.includes(key)) throw new Error(`Unsupported option: --${key}`);
  }
};

const one = (
  options: ParsedOptions,
  name: string,
  settings: { required?: boolean; defaultValue?: string } = {},
): string => {
  const values = options.get(name) ?? [];
  if (values.length > 1) throw new Error(`--${name} may be supplied only once`);
  const value = values[0] ?? settings.defaultValue;
  if (settings.required && !value) throw new Error(`--${name} is required`);
  return value ?? "";
};

const many = (options: ParsedOptions, name: string): string[] => options.get(name) ?? [];

const exists = async (path: string): Promise<boolean> => {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
};

const parsePositiveInteger = (value: string, name: string): number => {
  if (!/^[1-9][0-9]*$/.test(value)) throw new Error(`--${name} must be positive`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`--${name} is too large`);
  return parsed;
};

const output = (value: unknown): void => {
  process.stdout.write(`${JSON.stringify(value)}\n`);
};

const PPOpsConfigSourceSchema = z.object({
  network: z.object({ rpcUrls: z.array(z.url()).min(2) }),
  scanner: z.object({ poiNodeUrls: z.array(z.url()).min(1) }),
});

const init = async (options: ParsedOptions): Promise<void> => {
  assertAllowed(options, [
    "config",
    "creation-block",
    "from-ppops-config",
    "rpc-url",
    "poi-node",
    "mnemonic-file",
    "self-signing-key-file",
  ]);
  const configPath = resolve(one(options, "config", { required: true }));
  if (await exists(configPath)) throw new Error("Refusing to overwrite payer config");
  const creationBlock = parsePositiveInteger(
    one(options, "creation-block", { required: true }),
    "creation-block",
  );
  const sourcePath = one(options, "from-ppops-config");
  let rpcUrls = many(options, "rpc-url");
  let poiNodeUrls = many(options, "poi-node");
  if (sourcePath) {
    if (rpcUrls.length > 0 || poiNodeUrls.length > 0) {
      throw new Error("--from-ppops-config cannot be combined with RPC/POI options");
    }
    const source = PPOpsConfigSourceSchema.parse(
      JSON.parse(
        await readOwnerOnlyFile(resolve(sourcePath), {
          label: "PPOps source config",
          maxBytes: 64 * 1_024,
        }),
      ) as unknown,
    );
    rpcUrls = source.network.rpcUrls;
    poiNodeUrls = source.scanner.poiNodeUrls;
  }
  const root = dirname(configPath);
  const relativeOrGiven = (value: string, fallback: string): string => value || fallback;
  const mnemonicFile = relativeOrGiven(
    one(options, "mnemonic-file"),
    "./secrets/payer.mnemonic",
  );
  const selfSigningKeyFile = relativeOrGiven(
    one(options, "self-signing-key-file"),
    "./secrets/payer.evm-private-key",
  );
  const dbEncryptionKeyFile = "./secrets/railgun-db-encryption-key";
  const config = PayerConfigSchema.parse({
    schemaVersion: 1,
    network: {
      railgunNetworkName: PAYER_NETWORK,
      chainId: PAYER_CHAIN_ID,
      tokenAddress: PAYER_TOKEN_ADDRESS,
      tokenSymbol: PAYER_TOKEN_SYMBOL,
      tokenDecimals: PAYER_TOKEN_DECIMALS,
      deploymentBlock: PAYER_DEPLOYMENT_BLOCK,
      walletCreationBlock: creationBlock,
      rpcUrls,
    },
    poiNodeUrls,
    storage: {
      railgunDbPath: "./data/railgun-db",
      artifactsPath: "./data/artifacts",
      walletStatePath: "./data/wallet-state.json",
    },
    secrets: {
      dbEncryptionKeyFile,
      mnemonicFile,
      selfSigningKeyFile,
    },
    scanner: { providerPollingIntervalMs: 10_000 },
  });
  const resolveFromRoot = (path: string): string => resolve(root, path);
  const dbKeyPath = resolveFromRoot(dbEncryptionKeyFile);
  await mkdir(root, { recursive: true, mode: 0o700 });
  await writeNewSecret(dbKeyPath, generateDbEncryptionKey());
  try {
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, {
      mode: 0o600,
      flag: "wx",
    });
    await chmod(configPath, 0o600);
  } catch (error) {
    throw new Error("Failed to write payer config after generating its DB key", {
      cause: error,
    });
  }
  output({
    ok: true,
    configPath,
    chainId: PAYER_CHAIN_ID,
    token: PAYER_TOKEN_SYMBOL,
    walletCreationBlock: creationBlock,
    mnemonicFile: resolveFromRoot(mnemonicFile),
    selfSigningKeyFile: resolveFromRoot(selfSigningKeyFile),
    spendingMaterialCopied: false,
    next: `ppops-payer secrets-check --config ${configPath}`,
  });
};

const loadRuntimeSecrets = async (
  config: PayerConfig,
  requireSelfSigner: boolean,
): Promise<{ dbEncryptionKey: string; mnemonic?: string; evmPrivateKey?: string }> => {
  try {
    const dbEncryptionKey = await readSecret(
      config.secrets.dbEncryptionKeyFile,
      "db-encryption-key",
    );
    const walletExists = await exists(config.storage.walletStatePath);
    const mnemonic = walletExists
      ? undefined
      : await readSecret(config.secrets.mnemonicFile, "mnemonic");
    const evmPrivateKey = requireSelfSigner
      ? await readSecret(config.secrets.selfSigningKeyFile, "evm-private-key")
      : undefined;
    return {
      dbEncryptionKey,
      ...(mnemonic ? { mnemonic } : {}),
      ...(evmPrivateKey ? { evmPrivateKey } : {}),
    };
  } catch (error) {
    throw new SafeFailure("SECRET_INVALID", "A required local secret is unavailable", {
      cause: error,
    });
  }
};

const configValidate = async (options: ParsedOptions): Promise<void> => {
  assertAllowed(options, ["config"]);
  const config = await loadConfig(one(options, "config", { required: true }));
  output({
    ok: true,
    chainId: config.network.chainId,
    token: config.network.tokenSymbol,
    rpcProviderCount: config.network.rpcUrls.length,
    poiNodeCount: config.poiNodeUrls.length,
    walletCreationBlock: config.network.walletCreationBlock,
  });
};

const secretsCheck = async (options: ParsedOptions): Promise<void> => {
  assertAllowed(options, ["config"]);
  const config = await loadConfig(one(options, "config", { required: true }));
  try {
    await readSecret(config.secrets.dbEncryptionKeyFile, "db-encryption-key");
    await readSecret(config.secrets.mnemonicFile, "mnemonic");
    await readSecret(config.secrets.selfSigningKeyFile, "evm-private-key");
  } catch (error) {
    throw new SafeFailure("SECRET_INVALID", "A required local secret is unavailable", {
      cause: error,
    });
  }
  output({ ok: true, valuesReturned: false, privateFilePolicy: "owner-only" });
};

const verifiedRequest = async (options: ParsedOptions): Promise<PaymentRequest> => {
  try {
    return verifyPaymentRequest(
      await loadPaymentRequest(one(options, "request", { required: true })),
      one(options, "expected-signer", { required: true }),
    );
  } catch (error) {
    throw new SafeFailure("REQUEST_INVALID", "Payment request verification failed", {
      cause: error,
    });
  }
};

const requestVerify = async (options: ParsedOptions): Promise<void> => {
  assertAllowed(options, ["request", "expected-signer"]);
  const request = await verifiedRequest(options);
  output({
    ok: true,
    intentId: request.id,
    chainId: request.chainId,
    token: request.tokenSymbol,
    amountAtomic: request.amountAtomic,
    expiresAt: request.expiresAt,
    descriptorValid: true,
    paymentSubmitted: false,
  });
};

const submissionStatus = async (options: ParsedOptions): Promise<void> => {
  assertAllowed(options, ["config", "intent-id"]);
  const config = await loadConfig(one(options, "config", { required: true }));
  const intentId = one(options, "intent-id", { required: true });
  if (!/^pi_[0-9a-f]{32}$/.test(intentId)) {
    throw new SafeFailure("REQUEST_INVALID", "Intent ID is invalid");
  }
  const record = await new SubmissionJournal(
    submissionJournalPath(config.storage.walletStatePath),
  ).get(intentId);
  output({
    ok: true,
    intentId,
    recorded: record !== undefined,
    ...(record
      ? {
          status: record.status,
          ...(record.transactionHash
            ? { transactionHash: record.transactionHash }
            : {}),
        }
      : {}),
  });
};

const withEngine = async <T>(
  config: PayerConfig,
  secrets: { dbEncryptionKey: string; mnemonic?: string },
  operation: (engine: PayerRailgunEngine) => Promise<T>,
): Promise<T> => {
  const lock = await PayerRuntimeLock.acquire(
    payerRuntimeLockPath(config.storage.walletStatePath),
  );
  const engine = new PayerRailgunEngine(
    config,
    secrets.dbEncryptionKey,
    secrets.mnemonic,
  );
  try {
    await engine.start();
    return await operation(engine);
  } finally {
    try {
      await engine.stop().catch(() => undefined);
    } finally {
      await lock.release();
    }
  }
};

const sync = async (options: ParsedOptions): Promise<void> => {
  assertAllowed(options, ["config"]);
  const config = await loadConfig(one(options, "config", { required: true }));
  const secrets = await loadRuntimeSecrets(config, false);
  const result = await withEngine(config, secrets, async (engine) => ({
    railgunAddress: engine.railgunAddress,
    balances: await engine.syncBalances(),
  }));
  output({ ok: true, ...result });
};

const paySelfSigned = async (options: ParsedOptions): Promise<void> => {
  assertAllowed(options, [
    "config",
    "request",
    "expected-signer",
    "expected-payer",
    "expected-self-signer",
    "max-amount-atomic",
    "max-gas-cost-wei",
    "confirm-intent",
  ]);
  const request = await verifiedRequest(options);
  if (one(options, "confirm-intent", { required: true }) !== request.id) {
    throw new SafeFailure("REQUEST_INVALID", "Explicit intent confirmation does not match");
  }
  const maxAmount = one(options, "max-amount-atomic", { required: true });
  if (!/^[1-9][0-9]*$/.test(maxAmount) || BigInt(request.amountAtomic) > BigInt(maxAmount)) {
    throw new SafeFailure("REQUEST_INVALID", "Payment amount exceeds the explicit limit");
  }
  const config = await loadConfig(one(options, "config", { required: true }));
  const secrets = await loadRuntimeSecrets(config, true);
  if (!secrets.evmPrivateKey) throw new SafeFailure("SECRET_INVALID", "Missing signer");
  const result = await withEngine(config, secrets, async (engine) => {
    const expectedPayer = one(options, "expected-payer", { required: true });
    assertExpectedPayerAddress(engine.railgunAddress, expectedPayer);
    await engine.syncBalances();
    return sendSelfSignedTransfer({
      config,
      engine,
      request,
      dbEncryptionKey: secrets.dbEncryptionKey,
      evmPrivateKey: secrets.evmPrivateKey ?? "",
      expectedSelfSigner: one(options, "expected-self-signer", { required: true }),
      maxGasCostWei: one(options, "max-gas-cost-wei", { required: true }),
    });
  });
  output({
    ok: true,
    mode: "self-signed",
    intentId: request.id,
    amountAtomic: request.amountAtomic,
    transactionHash: result.transactionHash,
    selfSigner: result.selfSigner,
    maxGasCostWei: result.maxGasCostWei,
    privacyWarning: "public-self-signer-linked",
  });
};

const main = async (): Promise<void> => {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === "help" || command === "--help") {
    process.stdout.write(USAGE);
    return;
  }
  const options = parseOptions(args);
  switch (command) {
    case "init":
      await init(options);
      return;
    case "config-validate":
      await configValidate(options);
      return;
    case "secrets-check":
      await secretsCheck(options);
      return;
    case "request-verify":
      await requestVerify(options);
      return;
    case "sync":
      await sync(options);
      return;
    case "submission-status":
      await submissionStatus(options);
      return;
    case "pay-self-signed":
      await paySelfSigned(options);
      return;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
};

main().catch((error: unknown) => {
  output(safeFailureResult(error));
  process.exitCode = 1;
});
