import { lstat, readFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import { z } from "zod";

import {
  PAYER_CHAIN_ID,
  PAYER_DEPLOYMENT_BLOCK,
  PAYER_NETWORK,
  PAYER_TOKEN_ADDRESS,
  PAYER_TOKEN_DECIMALS,
  PAYER_TOKEN_SYMBOL,
} from "./constants.js";

const HttpUrlSchema = z
  .url()
  .refine((value) => value.startsWith("http://") || value.startsWith("https://"), {
    message: "Expected an http(s) URL",
  });
const PositiveIntegerSchema = z.number().int().positive().safe();

export const PayerConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    network: z
      .object({
        railgunNetworkName: z.literal(PAYER_NETWORK),
        chainId: z.literal(PAYER_CHAIN_ID),
        tokenAddress: z
          .string()
          .transform((value) => value.toLowerCase())
          .pipe(z.literal(PAYER_TOKEN_ADDRESS)),
        tokenSymbol: z.literal(PAYER_TOKEN_SYMBOL),
        tokenDecimals: z.literal(PAYER_TOKEN_DECIMALS),
        deploymentBlock: z.literal(PAYER_DEPLOYMENT_BLOCK),
        walletCreationBlock: PositiveIntegerSchema.min(PAYER_DEPLOYMENT_BLOCK),
        rpcUrls: z.array(HttpUrlSchema).min(2),
      })
      .strict(),
    poiNodeUrls: z.array(z.url().refine((value) => value.startsWith("https://"))).min(1),
    storage: z
      .object({
        railgunDbPath: z.string().min(1),
        artifactsPath: z.string().min(1),
        walletStatePath: z.string().min(1),
      })
      .strict(),
    secrets: z
      .object({
        dbEncryptionKeyFile: z.string().min(1),
        mnemonicFile: z.string().min(1),
        selfSigningKeyFile: z.string().min(1),
      })
      .strict(),
    scanner: z
      .object({
        providerPollingIntervalMs: PositiveIntegerSchema.min(1_000).default(10_000),
      })
      .strict()
      .default({ providerPollingIntervalMs: 10_000 }),
  })
  .strict()
  .superRefine((config, context) => {
    const rpcOrigins = config.network.rpcUrls.map((value) => new URL(value).origin);
    if (
      new Set(rpcOrigins).size < 2 ||
      new Set(rpcOrigins).size !== rpcOrigins.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["network", "rpcUrls"],
        message: "At least two RPC URLs with distinct origins are required",
      });
    }
  });

export type PayerConfig = z.infer<typeof PayerConfigSchema>;

const resolveConfigPaths = (config: PayerConfig, configPath: string): PayerConfig => {
  const root = dirname(configPath);
  const relativeToConfig = (path: string): string =>
    isAbsolute(path) ? resolve(path) : resolve(root, path);
  return {
    ...config,
    storage: {
      railgunDbPath: relativeToConfig(config.storage.railgunDbPath),
      artifactsPath: relativeToConfig(config.storage.artifactsPath),
      walletStatePath: relativeToConfig(config.storage.walletStatePath),
    },
    secrets: {
      dbEncryptionKeyFile: relativeToConfig(config.secrets.dbEncryptionKeyFile),
      mnemonicFile: relativeToConfig(config.secrets.mnemonicFile),
      selfSigningKeyFile: relativeToConfig(config.secrets.selfSigningKeyFile),
    },
  };
};

const assertPathsDoNotOverlap = (config: PayerConfig): void => {
  const paths = [...Object.values(config.storage), ...Object.values(config.secrets)];
  for (let leftIndex = 0; leftIndex < paths.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < paths.length; rightIndex += 1) {
      const left = paths[leftIndex];
      const right = paths[rightIndex];
      if (!left || !right) continue;
      const leftToRight = relative(left, right);
      const rightToLeft = relative(right, left);
      const overlaps =
        leftToRight === "" ||
        (!leftToRight.startsWith("..") && !isAbsolute(leftToRight)) ||
        (!rightToLeft.startsWith("..") && !isAbsolute(rightToLeft));
      if (overlaps) throw new Error("Storage and secret paths must be distinct");
    }
  }
};

export const loadConfig = async (path: string): Promise<PayerConfig> => {
  const configPath = resolve(path);
  const metadata = await lstat(configPath);
  if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size > 64 * 1024) {
    throw new Error("Payer config must be a regular, non-symlink file under 64 KiB");
  }
  if (process.platform !== "win32" && (metadata.mode & 0o077) !== 0) {
    throw new Error("Payer config may contain RPC credentials and must be owner-only");
  }
  const parsed = PayerConfigSchema.parse(
    JSON.parse(await readFile(configPath, "utf8")) as unknown,
  );
  const resolved = resolveConfigPaths(parsed, configPath);
  assertPathsDoNotOverlap(resolved);
  return resolved;
};
