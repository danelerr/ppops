import { createHash } from "node:crypto";
import { resolve } from "node:path";

import { validateRailgunAddress } from "@railgun-community/wallet";
import { z } from "zod";

import { readOwnerOnlyFile } from "../security/private-file.js";

const RailgunAddressSchema = z
  .string()
  .trim()
  .refine(validateRailgunAddress, "Expected a valid RAILGUN address");
const MillisecondsSchema = z.number().int().positive().safe();
const VersionSchema = z
  .string()
  .regex(/^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/)
  .refine(
    (value) => value.split(".").every((part) => Number.isSafeInteger(Number(part))),
    "Version components must be safe integers",
  );

const versionParts = (value: string): [number, number, number] => {
  const parts = value.split(".").map(Number);
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
};

const compareVersions = (left: string, right: string): number => {
  const leftParts = versionParts(left);
  const rightParts = versionParts(right);
  for (let index = 0; index < leftParts.length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
};

export const BroadcasterTrustConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    trustedFeeSigners: z.array(RailgunAddressSchema).min(1).max(16),
    pubSubTopic: z
      .string()
      .regex(/^\/waku\/2\/rs\/(?:0|[1-9][0-9]*)\/(?:0|[1-9][0-9]*)$/)
      .default("/waku/2/rs/5/1"),
    peerDiscoveryTimeoutMs: MillisecondsSchema.min(5_000).max(120_000).default(60_000),
    discoveryTimeoutMs: MillisecondsSchema.min(10_000).max(300_000).default(120_000),
    feeExpirationTimeoutMs: MillisecondsSchema.min(40_000).max(300_000).default(120_000),
    minimumQuoteValidityMs: MillisecondsSchema.min(120_000)
      .max(300_000)
      .default(180_000),
    minimumReliability: z.number().finite().min(0.75).max(1).default(0.75),
    broadcasterVersionRange: z
      .object({
        minVersion: VersionSchema.default("8.0.0"),
        maxVersion: VersionSchema.default("8.999.0"),
      })
      .strict()
      .default({ minVersion: "8.0.0", maxVersion: "8.999.0" }),
  })
  .strict()
  .superRefine((config, context) => {
    const normalized = config.trustedFeeSigners.map((value) => value.toLowerCase());
    if (new Set(normalized).size !== normalized.length) {
      context.addIssue({
        code: "custom",
        path: ["trustedFeeSigners"],
        message: "Trusted fee signers must be unique",
      });
    }
    if (
      compareVersions(
        config.broadcasterVersionRange.minVersion,
        config.broadcasterVersionRange.maxVersion,
      ) > 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["broadcasterVersionRange"],
        message: "Broadcaster version range is inverted",
      });
    }
  });

export type BroadcasterTrustConfig = z.infer<typeof BroadcasterTrustConfigSchema>;

export const broadcasterTrustFingerprint = (
  config: BroadcasterTrustConfig,
): string =>
  createHash("sha256")
    .update("ppops-broadcaster-trust:v1:")
    .update(JSON.stringify(config))
    .digest("hex");

export const loadBroadcasterTrustConfig = async (
  path: string,
): Promise<BroadcasterTrustConfig> =>
  BroadcasterTrustConfigSchema.parse(
    JSON.parse(
      await readOwnerOnlyFile(resolve(path), {
        label: "Broadcaster trust config",
        maxBytes: 64 * 1_024,
      }),
    ) as unknown,
  );
