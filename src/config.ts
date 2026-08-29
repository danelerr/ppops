import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { isIP } from "node:net";

import { isAddress } from "ethers";
import { z } from "zod";

export const ARBITRUM_MAINNET_CHAIN_ID = 42_161;
export const ARBITRUM_NATIVE_USDC =
  "0xaf88d065e77c8cc2239327c5edb3a432268e5831";
const DOCUMENTED_TEST_POI_HOST = "ppoi-agg.horsewithsixlegs.xyz";

const PortSchema = z.number().int().min(1).max(65_535);
const PositiveIntegerSchema = z.number().int().positive();
const AddressSchema = z
  .string()
  .refine(isAddress, "Expected an EVM address")
  .refine(
    (value) => value.toLowerCase() !== "0x0000000000000000000000000000000000000000",
    "Zero address is not a valid payment token",
  );
const HttpUrlSchema = z
  .url()
  .refine((value) => value.startsWith("http://") || value.startsWith("https://"), {
    message: "Expected an http(s) URL",
  });

const isLoopbackUrl = (value: string): boolean => {
  const hostname = new URL(value).hostname.toLowerCase();
  return (
    hostname === "localhost" ||
    hostname === "::1" ||
    hostname === "[::1]" ||
    (isIP(hostname) === 4 && hostname.split(".")[0] === "127")
  );
};

export const PPOpsConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    server: z
      .object({
        host: z.string().min(1).default("127.0.0.1"),
        port: PortSchema.default(8787),
        allowRemote: z.boolean().default(false),
        rateLimit: z
          .object({
            apiPerMinute: PositiveIntegerSchema.max(10_000).default(120),
            authFailuresPerMinute: PositiveIntegerSchema.max(1_000).default(10),
            checkoutPerMinute: PositiveIntegerSchema.max(10_000).default(60),
          })
          .optional(),
      })
      .default({ host: "127.0.0.1", port: 8787, allowRemote: false }),
    network: z.object({
      railgunNetworkName: z.string().min(1),
      chainId: PositiveIntegerSchema,
      tokenAddress: AddressSchema,
      tokenSymbol: z.string().regex(/^[A-Z0-9._-]{1,16}$/),
      tokenDecimals: z.number().int().min(0).max(255),
      rpcUrls: z.array(HttpUrlSchema).min(1),
      deploymentBlock: z.number().int().nonnegative(),
      finality: z.discriminatedUnion("mode", [
        z.object({ mode: z.literal("finalized") }),
        z.object({
          mode: z.literal("confirmations"),
          confirmations: PositiveIntegerSchema,
        }),
      ]),
    }),
    storage: z.object({
      sqlitePath: z.string().min(1),
      railgunDbPath: z.string().min(1),
      artifactsPath: z.string().min(1),
      walletStatePath: z.string().min(1),
    }),
    secrets: z.object({
      apiTokenFile: z.string().min(1),
      merchantSigningKeyFile: z.string().min(1),
      railgunDbEncryptionKeyFile: z.string().min(1),
      viewingKeyFile: z.string().min(1),
      webhookHmacKeyFile: z.string().min(1).optional(),
    }),
    scanner: z
      .object({
        intervalMs: PositiveIntegerSchema.min(5_000).default(30_000),
        poiNodeUrls: z.array(HttpUrlSchema).default([]),
        providerPollingIntervalMs: PositiveIntegerSchema.min(1_000).default(10_000),
        rpcTimeoutMs: PositiveIntegerSchema.min(1_000).max(120_000).default(20_000),
        maxRpcBlockLag: PositiveIntegerSchema.max(100).default(5),
        finalizedRecheckSeconds: PositiveIntegerSchema.max(2_592_000).default(604_800),
        scanStallThresholdMs: PositiveIntegerSchema.min(60_000)
          .max(7_200_000)
          .default(1_200_000),
        maxScanStalenessMs: PositiveIntegerSchema.min(60_000)
          .max(7_200_000)
          .optional(),
      })
      .default({
        intervalMs: 30_000,
        poiNodeUrls: [],
        providerPollingIntervalMs: 10_000,
        rpcTimeoutMs: 20_000,
        maxRpcBlockLag: 5,
        finalizedRecheckSeconds: 604_800,
        scanStallThresholdMs: 1_200_000,
      }),
    webhook: z
      .object({
        url: HttpUrlSchema,
        keyId: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/).optional(),
        timeoutMs: PositiveIntegerSchema.max(60_000).default(10_000),
        maxAttempts: PositiveIntegerSchema.max(100).default(12),
        baseRetryMs: PositiveIntegerSchema.default(5_000),
        maxRetryMs: PositiveIntegerSchema.default(3_600_000),
      })
      .optional(),
  })
  .superRefine((config, context) => {
    const host = config.server.host.toLowerCase();
    const loopback =
      host === "localhost" ||
      host === "::1" ||
      (isIP(host) === 4 && host.split(".")[0] === "127");
    if (!loopback && !config.server.allowRemote) {
      context.addIssue({
        code: "custom",
        path: ["server", "allowRemote"],
        message: "Non-loopback binding requires allowRemote: true",
      });
    }
    if (config.webhook && !config.secrets.webhookHmacKeyFile) {
      context.addIssue({
        code: "custom",
        path: ["secrets", "webhookHmacKeyFile"],
        message: "A webhook HMAC key file is required when webhook delivery is enabled",
      });
    }
    if (config.webhook) {
      const url = new URL(config.webhook.url);
      if (url.protocol !== "https:" && !isLoopbackUrl(config.webhook.url)) {
        context.addIssue({
          code: "custom",
          path: ["webhook", "url"],
          message: "Non-loopback webhook delivery requires HTTPS",
        });
      }
    }
    config.scanner.poiNodeUrls.forEach((value, index) => {
      if (new URL(value).protocol !== "https:" && !isLoopbackUrl(value)) {
        context.addIssue({
          code: "custom",
          path: ["scanner", "poiNodeUrls", index],
          message: "Non-loopback PPOI nodes require HTTPS",
        });
      }
    });
    if (config.network.chainId === ARBITRUM_MAINNET_CHAIN_ID) {
      if (config.network.railgunNetworkName !== "Arbitrum") {
        context.addIssue({
          code: "custom",
          path: ["network", "railgunNetworkName"],
          message: "Arbitrum mainnet chain ID requires the RAILGUN Arbitrum profile",
        });
      }
      if (config.network.tokenAddress.toLowerCase() !== ARBITRUM_NATIVE_USDC) {
        context.addIssue({
          code: "custom",
          path: ["network", "tokenAddress"],
          message: "PPOps v0.1 production profile supports native Arbitrum USDC only",
        });
      }
      if (config.network.tokenSymbol !== "USDC" || config.network.tokenDecimals !== 6) {
        context.addIssue({
          code: "custom",
          path: ["network", "tokenSymbol"],
          message: "Native Arbitrum USDC must use symbol USDC and 6 decimals",
        });
      }
      if (config.network.finality.mode !== "finalized") {
        context.addIssue({
          code: "custom",
          path: ["network", "finality"],
          message: "Arbitrum mainnet requires Ethereum-backed finalized block finality",
        });
      }
      const rpcOrigins = config.network.rpcUrls.map((value) => new URL(value).origin);
      if (
        new Set(rpcOrigins).size < 2 ||
        new Set(rpcOrigins).size !== rpcOrigins.length
      ) {
        context.addIssue({
          code: "custom",
          path: ["network", "rpcUrls"],
          message: "Arbitrum mainnet requires at least two RPC URLs and every origin must be unique",
        });
      }
      if (config.scanner.poiNodeUrls.length === 0) {
        context.addIssue({
          code: "custom",
          path: ["scanner", "poiNodeUrls"],
          message: "Arbitrum mainnet requires a production PPOI endpoint",
        });
      }
      if (
        config.scanner.poiNodeUrls.some(
          (value) => new URL(value).hostname === DOCUMENTED_TEST_POI_HOST,
        )
      ) {
        context.addIssue({
          code: "custom",
          path: ["scanner", "poiNodeUrls"],
          message: "The documented test PPOI endpoint must not be used on mainnet",
        });
      }
    }
  });

export type PPOpsConfig = z.infer<typeof PPOpsConfigSchema>;

const resolveConfigPaths = (config: PPOpsConfig, configPath: string): PPOpsConfig => {
  const root = dirname(configPath);
  const relativeToConfig = (path: string): string =>
    isAbsolute(path) ? path : resolve(root, path);
  return {
    ...config,
    storage: {
      sqlitePath: relativeToConfig(config.storage.sqlitePath),
      railgunDbPath: relativeToConfig(config.storage.railgunDbPath),
      artifactsPath: relativeToConfig(config.storage.artifactsPath),
      walletStatePath: relativeToConfig(config.storage.walletStatePath),
    },
    secrets: {
      apiTokenFile: relativeToConfig(config.secrets.apiTokenFile),
      merchantSigningKeyFile: relativeToConfig(config.secrets.merchantSigningKeyFile),
      railgunDbEncryptionKeyFile: relativeToConfig(
        config.secrets.railgunDbEncryptionKeyFile,
      ),
      viewingKeyFile: relativeToConfig(config.secrets.viewingKeyFile),
      ...(config.secrets.webhookHmacKeyFile
        ? {
            webhookHmacKeyFile: relativeToConfig(
              config.secrets.webhookHmacKeyFile,
            ),
          }
        : {}),
    },
  };
};

export const loadConfig = async (path: string): Promise<PPOpsConfig> => {
  const configPath = resolve(path);
  const source = await readFile(configPath, "utf8");
  const parsed = PPOpsConfigSchema.parse(JSON.parse(source) as unknown);
  const resolved = resolveConfigPaths(parsed, configPath);
  const protectedPaths = [
    ...Object.values(resolved.storage),
    ...Object.values(resolved.secrets).filter((value): value is string => value !== undefined),
  ];
  for (let leftIndex = 0; leftIndex < protectedPaths.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < protectedPaths.length; rightIndex += 1) {
      const left = protectedPaths[leftIndex];
      const right = protectedPaths[rightIndex];
      if (!left || !right) continue;
      const leftToRight = relative(left, right);
      const rightToLeft = relative(right, left);
      const overlaps =
        leftToRight === "" ||
        (!leftToRight.startsWith("..") && !isAbsolute(leftToRight)) ||
        (!rightToLeft.startsWith("..") && !isAbsolute(rightToLeft));
      if (overlaps) {
        throw new Error("Storage and secret paths must be distinct and non-overlapping");
      }
    }
  }
  return resolved;
};
