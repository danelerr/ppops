import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  BroadcasterTrustConfigSchema,
  broadcasterTrustFingerprint,
  loadBroadcasterTrustConfig,
} from "../src/broadcaster/config.js";

const TRUSTED_SIGNER =
  "0zk1qyjyhqjdkqd9qxusgj092ppxl92plvrk3s3cna9u73h5rwt0ghxvfrv7j6fe3z53l7lrzyqw5te7ku5v8fsrpeadzvpkudgawjv9dg08htj7z3mph5kd6dw50jc";
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true })));
});

describe("Broadcaster trust configuration", () => {
  it("applies bounded defaults and creates a stable trust fingerprint", () => {
    const config = BroadcasterTrustConfigSchema.parse({
      schemaVersion: 1,
      trustedFeeSigners: [TRUSTED_SIGNER],
    });
    expect(config).toMatchObject({
      pubSubTopic: "/waku/2/rs/5/1",
      minimumReliability: 0.75,
      minimumQuoteValidityMs: 180_000,
      broadcasterVersionRange: { minVersion: "8.0.0", maxVersion: "8.999.0" },
    });
    expect(broadcasterTrustFingerprint(config)).toMatch(/^[0-9a-f]{64}$/);
    expect(broadcasterTrustFingerprint(config)).toBe(broadcasterTrustFingerprint(config));
  });

  it("rejects duplicate signers and an inverted version range", () => {
    expect(() =>
      BroadcasterTrustConfigSchema.parse({
        schemaVersion: 1,
        trustedFeeSigners: [TRUSTED_SIGNER, TRUSTED_SIGNER],
      }),
    ).toThrow(/unique/);
    expect(() =>
      BroadcasterTrustConfigSchema.parse({
        schemaVersion: 1,
        trustedFeeSigners: [TRUSTED_SIGNER],
        broadcasterVersionRange: { minVersion: "9.0.0", maxVersion: "8.999.0" },
      }),
    ).toThrow(/inverted/);
    expect(() =>
      BroadcasterTrustConfigSchema.parse({
        schemaVersion: 1,
        trustedFeeSigners: [TRUSTED_SIGNER],
        minimumQuoteValidityMs: 119_999,
      }),
    ).toThrow();
  });

  it("loads only an owner-only regular file", async () => {
    const root = await mkdtemp(join(tmpdir(), "ppops-broadcaster-config-"));
    roots.push(root);
    const path = join(root, "broadcaster.json");
    await writeFile(
      path,
      JSON.stringify({ schemaVersion: 1, trustedFeeSigners: [TRUSTED_SIGNER] }),
      { mode: 0o600 },
    );
    await expect(loadBroadcasterTrustConfig(path)).resolves.toMatchObject({
      trustedFeeSigners: [TRUSTED_SIGNER],
    });
    if (process.platform !== "win32") {
      await chmod(path, 0o644);
      await expect(loadBroadcasterTrustConfig(path)).rejects.toThrow(/group or others/);
    }
  });
});
