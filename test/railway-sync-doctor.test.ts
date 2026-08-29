import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  compareRailwayCacheInspections,
  inspectRailwayCache,
} from "../src/pilot/railway-sync-doctor.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true })));
});

describe("Railway cache doctor", () => {
  it("inspects metadata without reading cache contents", async () => {
    const root = await mkdtemp(join(tmpdir(), "ppops-railway-doctor-"));
    roots.push(root);
    const nested = join(root, "blob");
    await mkdir(nested);
    await writeFile(join(nested, "secret-cache"), "must-not-be-returned");
    const result = await inspectRailwayCache(root, {
      nowMs: Date.now(),
      quietThresholdSeconds: 120,
    });

    expect(result).toMatchObject({
      state: "ACTIVE",
      cacheBytes: 20,
      fileCount: 1,
      metadataOnly: true,
    });
    expect(JSON.stringify(result)).not.toContain("must-not-be-returned");
  });

  it("reports a missing cache without failing", async () => {
    const root = await mkdtemp(join(tmpdir(), "ppops-railway-doctor-missing-"));
    roots.push(root);
    await expect(inspectRailwayCache(join(root, "missing"))).resolves.toMatchObject({
      state: "MISSING",
      cacheBytes: 0,
      fileCount: 0,
    });
  });

  it("distinguishes a recent write from measured advancement", () => {
    const initial = {
      state: "ACTIVE" as const,
      cacheBytes: 100,
      fileCount: 2,
      latestWriteAt: 1_000,
      secondsSinceLastWrite: 5,
      metadataOnly: true as const,
    };

    expect(compareRailwayCacheInspections(initial, initial).advanced).toBe(false);
    expect(
      compareRailwayCacheInspections(initial, {
        ...initial,
        cacheBytes: 101,
        latestWriteAt: 1_001,
      }).advanced,
    ).toBe(true);
  });
});
