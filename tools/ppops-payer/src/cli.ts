#!/usr/bin/env node

import { constants, writeSync } from "node:fs";
import {
  access,
  chmod,
  mkdir,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { z } from "zod";

import {
  BroadcasterTrustConfigSchema,
  broadcasterTrustFingerprint,
  loadBroadcasterTrustConfig,
  type BroadcasterTrustConfig,
} from "./broadcaster/config.js";
import { BroadcasterSession } from "./broadcaster/session.js";
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
import {
  assertExpectedPayerAddress,
  assertExpectedSelfSigner,
  deriveExpectedSelfSigningKey,
} from "./execution-guards.js";
import { sendBroadcasterTransfer } from "./railgun/broadcaster-transfer.js";
import { PayerRailgunEngine } from "./railgun/engine.js";
import { readReceiptQuorum } from "./railgun/rpc-quorum.js";
import { sendSelfSignedTransfer } from "./railgun/self-signed-transfer.js";
import {
  assertLivePaymentRequestSource,
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
  ppops-payer broadcaster-config-init --output PATH \\
    --trusted-fee-signer 0zk_ADDRESS [--trusted-fee-signer 0zk_ADDRESS]
  ppops-payer broadcaster-preflight --config PATH --broadcaster-config PATH
  ppops-payer derive-self-signing-key --config PATH \\
    --expected-address EVM_ADDRESS [--derivation-index INDEX]
  ppops-payer secrets-check --config PATH
  ppops-payer request-verify --request URL_OR_PATH --expected-signer ADDRESS
  ppops-payer sync --config PATH
  ppops-payer submission-status --config PATH --intent-id pi_ID
  ppops-payer finalize-poi --config PATH --intent-id pi_ID \\
    --expected-payer 0zk_ADDRESS [--expected-railgun-txid TXID]
  ppops-payer prepare-self-signed --config PATH --request URL \\
    --expected-signer ADDRESS --max-amount-atomic AMOUNT \\
    --expected-payer 0zk_ADDRESS --expected-self-signer EVM_ADDRESS \\
    --max-gas-cost-wei WEI
  ppops-payer pay-self-signed --config PATH --request URL \\
    --expected-signer ADDRESS --max-amount-atomic AMOUNT \\
    --expected-payer 0zk_ADDRESS --expected-self-signer EVM_ADDRESS \\
    --max-gas-cost-wei WEI --confirm-intent pi_ID
  ppops-payer prepare-broadcaster --config PATH --broadcaster-config PATH \\
    --request URL --expected-signer ADDRESS --max-amount-atomic AMOUNT \\
    --expected-payer 0zk_ADDRESS --max-broadcaster-fee-atomic AMOUNT
  ppops-payer pay-broadcaster --config PATH --broadcaster-config PATH \\
    --request URL --expected-signer ADDRESS --max-amount-atomic AMOUNT \\
    --expected-payer 0zk_ADDRESS --max-broadcaster-fee-atomic AMOUNT \\
    --confirm-intent pi_ID
  ppops-payer recover-broadcaster --config PATH --intent-id pi_ID \\
    --expected-payer 0zk_ADDRESS

Secrets are read only from private files. Never pass a mnemonic or private key
as a CLI argument. pay-self-signed is an explicit diagnostic Gate A and links
the public self-signing address to the otherwise encrypted transaction.
pay-broadcaster uses Waku and does not load the optional EVM self-signing key.
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

const parseNonNegativeInteger = (value: string, name: string): number => {
  if (!/^(?:0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`--${name} must be a non-negative integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`--${name} is too large`);
  return parsed;
};

const parseFiniteNumber = (value: string, name: string): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`--${name} must be finite`);
  return parsed;
};

const output = (value: unknown): void => {
  writeSync(process.stdout.fd, `${JSON.stringify(value)}\n`);
};

const trustedBroadcasterConfigFrom = async (
  path: string,
): Promise<BroadcasterTrustConfig> => {
  try {
    return await loadBroadcasterTrustConfig(path);
  } catch (error) {
    throw new SafeFailure(
      "BROADCASTER_CONFIG_INVALID",
      "Broadcaster trust configuration is unavailable or invalid",
      { cause: error },
    );
  }
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
    selfSigningKeyRequiredForBroadcaster: false,
    next: `ppops-payer sync --config ${configPath}`,
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

const broadcasterConfigInit = async (options: ParsedOptions): Promise<void> => {
  assertAllowed(options, [
    "output",
    "trusted-fee-signer",
    "pubsub-topic",
    "peer-discovery-timeout-ms",
    "discovery-timeout-ms",
    "fee-expiration-timeout-ms",
    "minimum-quote-validity-ms",
    "minimum-reliability",
    "minimum-version",
    "maximum-version",
  ]);
  const outputPath = resolve(one(options, "output", { required: true }));
  if (await exists(outputPath)) {
    throw new SafeFailure(
      "BROADCASTER_CONFIG_INVALID",
      "Refusing to overwrite Broadcaster trust configuration",
    );
  }
  let config: BroadcasterTrustConfig;
  try {
    const optionalMilliseconds = (name: string): number | undefined => {
      const value = one(options, name);
      return value ? parsePositiveInteger(value, name) : undefined;
    };
    const reliability = one(options, "minimum-reliability");
    config = BroadcasterTrustConfigSchema.parse({
      schemaVersion: 1,
      trustedFeeSigners: many(options, "trusted-fee-signer"),
      pubSubTopic: one(options, "pubsub-topic") || undefined,
      peerDiscoveryTimeoutMs: optionalMilliseconds("peer-discovery-timeout-ms"),
      discoveryTimeoutMs: optionalMilliseconds("discovery-timeout-ms"),
      feeExpirationTimeoutMs: optionalMilliseconds("fee-expiration-timeout-ms"),
      minimumQuoteValidityMs: optionalMilliseconds("minimum-quote-validity-ms"),
      minimumReliability: reliability
        ? parseFiniteNumber(reliability, "minimum-reliability")
        : undefined,
      broadcasterVersionRange: {
        minVersion: one(options, "minimum-version") || undefined,
        maxVersion: one(options, "maximum-version") || undefined,
      },
    });
  } catch (error) {
    throw new SafeFailure(
      "BROADCASTER_CONFIG_INVALID",
      "Broadcaster trust configuration inputs are invalid",
      { cause: error },
    );
  }
  await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 });
  try {
    await writeFile(outputPath, `${JSON.stringify(config, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    await chmod(outputPath, 0o600);
  } catch (error) {
    throw new SafeFailure(
      "BROADCASTER_CONFIG_INVALID",
      "Unable to persist Broadcaster trust configuration",
      { cause: error },
    );
  }
  output({
    ok: true,
    configPath: outputPath,
    trustedFeeSignerCount: config.trustedFeeSigners.length,
    trustFingerprint: broadcasterTrustFingerprint(config),
    valuesSourcePinnedByOperator: true,
  });
};

const broadcasterPreflight = async (options: ParsedOptions): Promise<void> => {
  assertAllowed(options, ["config", "broadcaster-config"]);
  await loadConfig(one(options, "config", { required: true }));
  const trustConfig = await trustedBroadcasterConfigFrom(
    one(options, "broadcaster-config", { required: true }),
  );
  const session = new BroadcasterSession(trustConfig);
  try {
    await session.start();
    const selected = await session.discover();
    const peers = await session.peerCounts();
    output({
      ok: true,
      broadcasterReady: true,
      chainId: PAYER_CHAIN_ID,
      token: PAYER_TOKEN_SYMBOL,
      connectionStatus: session.connectionStatus(),
      trustedFeeSignerCount: trustConfig.trustedFeeSigners.length,
      trustFingerprint: broadcasterTrustFingerprint(trustConfig),
      quoteFingerprint: selected.fingerprint,
      quoteReliability: selected.selected.tokenFee.reliability,
      quoteValidityMs: selected.selected.tokenFee.expiration - Date.now(),
      availableWallets: selected.selected.tokenFee.availableWallets,
      peers,
      proofGenerated: false,
      paymentSubmitted: false,
    });
  } finally {
    await session.stop();
  }
};

const deriveSelfSigningKey = async (options: ParsedOptions): Promise<void> => {
  assertAllowed(options, ["config", "expected-address", "derivation-index"]);
  const config = await loadConfig(one(options, "config", { required: true }));
  const expectedAddress = one(options, "expected-address", { required: true });
  const derivationIndex = parseNonNegativeInteger(
    one(options, "derivation-index", { defaultValue: "0" }),
    "derivation-index",
  );
  let mnemonic: string;
  try {
    mnemonic = await readSecret(config.secrets.mnemonicFile, "mnemonic");
  } catch (error) {
    throw new SafeFailure("SECRET_INVALID", "The payer mnemonic is unavailable", {
      cause: error,
    });
  }
  const derived = deriveExpectedSelfSigningKey(
    mnemonic,
    derivationIndex,
    expectedAddress,
  );
  const alreadyExists = await exists(config.secrets.selfSigningKeyFile);
  try {
    if (alreadyExists) {
      const existing = await readSecret(
        config.secrets.selfSigningKeyFile,
        "evm-private-key",
      );
      assertExpectedSelfSigner(existing, derived.address);
    } else {
      await writeNewSecret(config.secrets.selfSigningKeyFile, derived.privateKey);
    }
  } catch (error) {
    if (error instanceof SafeFailure) throw error;
    throw new SafeFailure("SECRET_INVALID", "Unable to store the self-signing key", {
      cause: error,
    });
  }
  output({
    ok: true,
    address: derived.address,
    derivationIndex,
    derivationPath: derived.derivationPath,
    created: !alreadyExists,
    privateKeyPrinted: false,
    next: `ppops-payer secrets-check --config ${resolve(one(options, "config", { required: true }))}`,
  });
};

const secretsCheck = async (options: ParsedOptions): Promise<void> => {
  assertAllowed(options, ["config"]);
  const config = await loadConfig(one(options, "config", { required: true }));
  const walletImported = await exists(config.storage.walletStatePath);
  try {
    if (walletImported) {
      await readOwnerOnlyFile(config.storage.walletStatePath, {
        label: "Payer wallet state",
        maxBytes: 64 * 1_024,
      });
    }
    await readSecret(config.secrets.dbEncryptionKeyFile, "db-encryption-key");
    if (!walletImported) {
      await readSecret(config.secrets.mnemonicFile, "mnemonic");
    }
    const selfSigningKeyAvailable = await exists(config.secrets.selfSigningKeyFile);
    if (selfSigningKeyAvailable) {
      await readSecret(config.secrets.selfSigningKeyFile, "evm-private-key");
    }
    output({
      ok: true,
      walletImported,
      mnemonicRequired: !walletImported,
      selfSigningKeyAvailable,
      broadcasterModeRequiresSelfSigningKey: false,
      valuesReturned: false,
      privateFilePolicy: "owner-only",
    });
  } catch (error) {
    throw new SafeFailure("SECRET_INVALID", "A required local secret is unavailable", {
      cause: error,
    });
  }
};

const verifiedRequestFrom = async (
  source: string,
  expectedSigner: string,
): Promise<PaymentRequest> => {
  try {
    return verifyPaymentRequest(
      await loadPaymentRequest(source),
      expectedSigner,
    );
  } catch (error) {
    throw new SafeFailure("REQUEST_INVALID", "Payment request verification failed", {
      cause: error,
    });
  }
};

const requestVerify = async (options: ParsedOptions): Promise<void> => {
  assertAllowed(options, ["request", "expected-signer"]);
  const request = await verifiedRequestFrom(
    one(options, "request", { required: true }),
    one(options, "expected-signer", { required: true }),
  );
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
          submissionMode: record.submissionMode ?? "SELF_SIGNED",
          status: record.status,
          ...(record.broadcasterFeeAmountAtomic !== undefined
            ? { broadcasterFeeAmountAtomic: record.broadcasterFeeAmountAtomic }
            : {}),
          ...(record.submissionMode === "BROADCASTER"
            ? {
                broadcasterQuoteFingerprint: record.broadcasterQuoteFingerprint,
                canonicalTransactionHashResolved:
                  record.transactionHash !== undefined,
              }
            : {}),
          ...(record.reportedTransactionHash
            ? { broadcasterReportedTransactionHash: record.reportedTransactionHash }
            : {}),
          ...(record.nonce !== undefined ? { nonce: record.nonce } : {}),
          ...(record.transactionHash
            ? { transactionHash: record.transactionHash }
            : {}),
          ...(record.blockNumber !== undefined
            ? { blockNumber: record.blockNumber }
            : {}),
        }
      : {}),
  });
};

const finalizePOI = async (options: ParsedOptions): Promise<void> => {
  assertAllowed(options, [
    "config",
    "intent-id",
    "expected-payer",
    "expected-railgun-txid",
  ]);
  const config = await loadConfig(one(options, "config", { required: true }));
  const intentId = one(options, "intent-id", { required: true });
  if (!/^pi_[0-9a-f]{32}$/.test(intentId)) {
    throw new SafeFailure("REQUEST_INVALID", "Intent ID is invalid");
  }
  const record = await new SubmissionJournal(
    submissionJournalPath(config.storage.walletStatePath),
  ).get(intentId);
  if (record?.status !== "MINED" || !record.transactionHash) {
    throw new SafeFailure(
      "POI_NOT_READY",
      "PPOI finalization requires a mined local submission record",
    );
  }
  const expectedRailgunTxid = one(options, "expected-railgun-txid");
  if (expectedRailgunTxid && !/^(?:0x)?[0-9a-fA-F]{64}$/.test(expectedRailgunTxid)) {
    throw new SafeFailure("REQUEST_INVALID", "Expected RAILGUN transaction ID is invalid");
  }
  const secrets = await loadRuntimeSecrets(config, false);
  const result = await withEngine(config, secrets, async (engine) => {
    assertExpectedPayerAddress(
      engine.railgunAddress,
      one(options, "expected-payer", { required: true }),
    );
    await engine.syncBalances();
    return engine.finalizePOIForTransaction(
      record.transactionHash as string,
      expectedRailgunTxid || undefined,
    );
  });
  output({ ok: true, intentId, ...result });
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
    let cleanupError: unknown;
    try {
      await engine.stop();
    } catch (error) {
      cleanupError = error;
    } finally {
      try {
        await lock.release();
      } catch (error) {
        cleanupError ??= error;
      }
    }
    if (cleanupError) {
      throw new SafeFailure(
        "ENGINE_STOP_FAILED",
        "RAILGUN payer runtime did not shut down cleanly",
        { cause: cleanupError },
      );
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

const runSelfSigned = async (
  options: ParsedOptions,
  submit: boolean,
): Promise<void> => {
  assertAllowed(options, [
    "config",
    "request",
    "expected-signer",
    "expected-payer",
    "expected-self-signer",
    "max-amount-atomic",
    "max-gas-cost-wei",
    ...(submit ? ["confirm-intent"] : []),
  ]);
  const requestSource = one(options, "request", { required: true });
  const expectedSigner = one(options, "expected-signer", { required: true });
  try {
    assertLivePaymentRequestSource(requestSource);
  } catch (error) {
    throw new SafeFailure("REQUEST_INVALID", "A live payment request is required", {
      cause: error,
    });
  }
  const request = await verifiedRequestFrom(requestSource, expectedSigner);
  if (
    submit &&
    one(options, "confirm-intent", { required: true }) !== request.id
  ) {
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
      requestSource,
      expectedMerchantSigner: expectedSigner,
      submit,
    });
  });
  if (!submit) {
    output({
      ok: true,
      mode: "prepare-only",
      intentId: request.id,
      amountAtomic: request.amountAtomic,
      selfSigner: result.selfSigner,
      maxGasCostWei: result.maxGasCostWei,
      proofGenerated: true,
      paymentSubmitted: false,
    });
    return;
  }
  if (!result.transactionHash || result.receiptStatus === "NOT_SUBMITTED") {
    throw new SafeFailure("INTERNAL_ERROR", "Submission result is incomplete");
  }
  output({
    ok: true,
    mode: "self-signed",
    intentId: request.id,
    amountAtomic: request.amountAtomic,
    transactionHash: result.transactionHash,
    selfSigner: result.selfSigner,
    maxGasCostWei: result.maxGasCostWei,
    receiptStatus: result.receiptStatus,
    ...(result.blockNumber !== undefined ? { blockNumber: result.blockNumber } : {}),
    privacyWarning: "public-self-signer-linked",
    poiFinalizationRequired: true,
    next: `ppops-payer finalize-poi --config ${resolve(
      one(options, "config", { required: true }),
    )} --intent-id ${request.id} --expected-payer PINNED_PAYER_0ZK_ADDRESS`,
  });
};

const runBroadcaster = async (
  options: ParsedOptions,
  submit: boolean,
): Promise<void> => {
  assertAllowed(options, [
    "config",
    "broadcaster-config",
    "request",
    "expected-signer",
    "expected-payer",
    "max-amount-atomic",
    "max-broadcaster-fee-atomic",
    ...(submit ? ["confirm-intent"] : []),
  ]);
  const requestSource = one(options, "request", { required: true });
  const expectedSigner = one(options, "expected-signer", { required: true });
  try {
    assertLivePaymentRequestSource(requestSource);
  } catch (error) {
    throw new SafeFailure("REQUEST_INVALID", "A live payment request is required", {
      cause: error,
    });
  }
  const request = await verifiedRequestFrom(requestSource, expectedSigner);
  if (submit && one(options, "confirm-intent", { required: true }) !== request.id) {
    throw new SafeFailure("REQUEST_INVALID", "Explicit intent confirmation does not match");
  }
  const maxAmount = one(options, "max-amount-atomic", { required: true });
  if (!/^[1-9][0-9]*$/.test(maxAmount) || BigInt(request.amountAtomic) > BigInt(maxAmount)) {
    throw new SafeFailure("REQUEST_INVALID", "Payment amount exceeds the explicit limit");
  }
  const configPath = one(options, "config", { required: true });
  const config = await loadConfig(configPath);
  const trustConfig = await trustedBroadcasterConfigFrom(
    one(options, "broadcaster-config", { required: true }),
  );
  const secrets = await loadRuntimeSecrets(config, false);
  const result = await withEngine(config, secrets, async (engine) => {
    assertExpectedPayerAddress(
      engine.railgunAddress,
      one(options, "expected-payer", { required: true }),
    );
    await engine.syncBalances();
    const session = new BroadcasterSession(trustConfig);
    try {
      await session.start();
      return await sendBroadcasterTransfer({
        config,
        engine,
        session,
        request,
        dbEncryptionKey: secrets.dbEncryptionKey,
        maxBroadcasterFeeAtomic: one(options, "max-broadcaster-fee-atomic", {
          required: true,
        }),
        requestSource,
        expectedMerchantSigner: expectedSigner,
        submit,
      });
    } finally {
      await session.stop();
    }
  });

  if (!submit) {
    output({
      ok: true,
      mode: "prepare-broadcaster",
      intentId: request.id,
      amountAtomic: request.amountAtomic,
      broadcasterFeeAmountAtomic: result.broadcasterFeeAmountAtomic,
      maxBroadcasterFeeAtomic: one(options, "max-broadcaster-fee-atomic", {
        required: true,
      }),
      gasEstimate: result.gasEstimate,
      quoteReliability: result.quoteReliability,
      quoteValidityMs: result.quoteValidityMs,
      proofGenerated: true,
      paymentSubmitted: false,
      selfSigningKeyLoaded: false,
    });
    return;
  }
  if (
    result.receiptStatus === "NOT_SUBMITTED" ||
    (result.receiptStatus === "MINED" && !result.transactionHash)
  ) {
    throw new SafeFailure("INTERNAL_ERROR", "Broadcaster submission result is incomplete");
  }
  output({
    ok: true,
    mode: "broadcaster",
    intentId: request.id,
    amountAtomic: request.amountAtomic,
    broadcasterFeeAmountAtomic: result.broadcasterFeeAmountAtomic,
    ...(result.transactionHash ? { transactionHash: result.transactionHash } : {}),
    ...(result.reportedTransactionHash
      ? { broadcasterReportedTransactionHash: result.reportedTransactionHash }
      : {}),
    canonicalTransactionHashResolved:
      result.canonicalTransactionHashResolved,
    receiptStatus: result.receiptStatus,
    ...(result.blockNumber !== undefined ? { blockNumber: result.blockNumber } : {}),
    publicSelfSigningAddressUsed: false,
    poiFinalizationRequired: result.receiptStatus === "MINED",
    next:
      result.receiptStatus === "PENDING"
        ? `ppops-payer recover-broadcaster --config ${resolve(configPath)} --intent-id ${request.id} --expected-payer PINNED_PAYER_0ZK_ADDRESS`
        : `ppops-payer finalize-poi --config ${resolve(configPath)} --intent-id ${request.id} --expected-payer PINNED_PAYER_0ZK_ADDRESS`,
  });
};

const recoverBroadcaster = async (options: ParsedOptions): Promise<void> => {
  assertAllowed(options, ["config", "intent-id", "expected-payer"]);
  const config = await loadConfig(one(options, "config", { required: true }));
  const intentId = one(options, "intent-id", { required: true });
  if (!/^pi_[0-9a-f]{32}$/.test(intentId)) {
    throw new SafeFailure("REQUEST_INVALID", "Intent ID is invalid");
  }
  const journal = new SubmissionJournal(
    submissionJournalPath(config.storage.walletStatePath),
  );
  const record = await journal.get(intentId);
  if (!record || record.submissionMode !== "BROADCASTER") {
    throw new SafeFailure(
      "REQUEST_INVALID",
      "No Broadcaster submission reservation exists for this intent",
    );
  }
  const expectedPayer = one(options, "expected-payer", { required: true });
  if (!record.payerRailgunAddress) {
    throw new SafeFailure(
      "JOURNAL_UPDATE_FAILED",
      "Broadcaster reservation has no pinned payer identity",
    );
  }
  assertExpectedPayerAddress(record.payerRailgunAddress, expectedPayer);
  if (record.status === "MINED" || record.status === "REVERTED") {
    output({
      ok: true,
      intentId,
      recovered: true,
      status: record.status,
      transactionHash: record.transactionHash,
      blockNumber: record.blockNumber,
      canonicalTransactionHashResolved: true,
      paymentRetryPermitted: false,
    });
    return;
  }

  if (!record.nullifiers) throw new Error("Broadcaster reservation lost its nullifiers");
  const secrets = await loadRuntimeSecrets(config, false);
  const transactionHash = await withEngine(config, secrets, async (engine) => {
    assertExpectedPayerAddress(engine.railgunAddress, expectedPayer);
    assertExpectedPayerAddress(engine.railgunAddress, record.payerRailgunAddress as string);
    await engine.syncBalances();
    return engine.recoverTransactionHashForNullifiers(record.nullifiers as string[]);
  });
  if (!transactionHash) {
    output({
      ok: true,
      intentId,
      recovered: false,
      status: record.status,
      ...(record.reportedTransactionHash
        ? { broadcasterReportedTransactionHash: record.reportedTransactionHash }
        : {}),
      canonicalTransactionHashResolved: false,
      paymentRetryPermitted: false,
    });
    return;
  }
  if (
    record.transactionHash &&
    record.transactionHash.toLowerCase() !== transactionHash.toLowerCase()
  ) {
    throw new SafeFailure(
      "JOURNAL_UPDATE_FAILED",
      "Recovered nullifiers conflict with the journaled canonical transaction hash",
    );
  }
  try {
    await journal.markSubmitted(intentId, transactionHash);
  } catch (error) {
    throw new SafeFailure("JOURNAL_UPDATE_FAILED", "Recovery journal update failed", {
      cause: error,
    });
  }

  const receipt = await readReceiptQuorum(config, transactionHash);
  if (!receipt) {
    output({
      ok: true,
      intentId,
      recovered: true,
      status: "SUBMITTED",
      transactionHash,
      receiptQuorum: false,
      canonicalTransactionHashResolved: true,
      paymentRetryPermitted: false,
    });
    return;
  }
  try {
    await journal.markMined(intentId, receipt.blockNumber, receipt.succeeded);
  } catch (error) {
    throw new SafeFailure("JOURNAL_UPDATE_FAILED", "Recovery receipt update failed", {
      cause: error,
    });
  }
  output({
    ok: true,
    intentId,
    recovered: true,
    status: receipt.succeeded ? "MINED" : "REVERTED",
    transactionHash,
    blockNumber: receipt.blockNumber,
    receiptQuorum: true,
    canonicalTransactionHashResolved: true,
    providerAgreement: receipt.providerAgreement,
    paymentRetryPermitted: false,
  });
};

const main = async (): Promise<void> => {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === "help" || command === "--help") {
    writeSync(process.stdout.fd, USAGE);
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
    case "broadcaster-config-init":
      await broadcasterConfigInit(options);
      return;
    case "broadcaster-preflight":
      await broadcasterPreflight(options);
      return;
    case "derive-self-signing-key":
      await deriveSelfSigningKey(options);
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
    case "finalize-poi":
      await finalizePOI(options);
      return;
    case "prepare-self-signed":
      await runSelfSigned(options, false);
      return;
    case "pay-self-signed":
      await runSelfSigned(options, true);
      return;
    case "prepare-broadcaster":
      await runBroadcaster(options, false);
      return;
    case "pay-broadcaster":
      await runBroadcaster(options, true);
      return;
    case "recover-broadcaster":
      await recoverBroadcaster(options);
      return;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
};

const exitAfterOutputFlush = (code: number): void => {
  let pendingStreams = 2;
  const flushed = (): void => {
    pendingStreams -= 1;
    if (pendingStreams === 0) process.exit(code);
  };
  // The RAILGUN prover leaves worker threads referenced even after the engine,
  // provider and LevelDB have been cleanly stopped. Flush both output streams,
  // then terminate the already-closed CLI runtime deterministically.
  process.stdout.end(flushed);
  process.stderr.end(flushed);
};

// A pending Promise does not keep Node alive. Once the SDK polling provider is
// paused, wallet decryption/POI completion can still be pending with no ref'ed
// handle of its own. Keep the short-lived CLI alive until main settles.
const runtimeKeepalive = setInterval(() => undefined, 1_000);

main().then(
  () => {
    clearInterval(runtimeKeepalive);
    exitAfterOutputFlush(0);
  },
  (error: unknown) => {
    clearInterval(runtimeKeepalive);
    output(safeFailureResult(error));
    exitAfterOutputFlush(1);
  },
);
