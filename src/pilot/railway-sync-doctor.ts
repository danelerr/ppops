import { lstat, readdir } from "node:fs/promises";
import { resolve } from "node:path";

type RailwayCacheState = "MISSING" | "EMPTY" | "ACTIVE" | "QUIET";

type RailwayCacheInspection = {
  state: RailwayCacheState;
  cacheBytes: number;
  fileCount: number;
  latestWriteAt?: number;
  secondsSinceLastWrite?: number;
  metadataOnly: true;
};

type RailwayCacheObservation = {
  initial: RailwayCacheInspection;
  current: RailwayCacheInspection;
  advanced: boolean;
};

type CacheMetadata = {
  bytes: number;
  files: number;
  latestMtimeMs?: number;
};

const collectMetadata = async (path: string): Promise<CacheMetadata> => {
  const entries = await readdir(path, { withFileTypes: true });
  let bytes = 0;
  let files = 0;
  let latestMtimeMs: number | undefined;
  for (const entry of entries) {
    const child = resolve(path, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      const nested = await collectMetadata(child);
      bytes += nested.bytes;
      files += nested.files;
      if (
        nested.latestMtimeMs !== undefined &&
        (latestMtimeMs === undefined || nested.latestMtimeMs > latestMtimeMs)
      ) {
        latestMtimeMs = nested.latestMtimeMs;
      }
      continue;
    }
    if (!entry.isFile()) continue;
    const stats = await lstat(child);
    bytes += stats.size;
    files += 1;
    if (latestMtimeMs === undefined || stats.mtimeMs > latestMtimeMs) {
      latestMtimeMs = stats.mtimeMs;
    }
  }
  return { bytes, files, latestMtimeMs };
};

export const inspectRailwayCache = async (
  indexedDbPath: string,
  options: { nowMs?: number; quietThresholdSeconds?: number } = {},
): Promise<RailwayCacheInspection> => {
  const nowMs = options.nowMs ?? Date.now();
  const quietThresholdSeconds = options.quietThresholdSeconds ?? 1_200;
  if (!Number.isFinite(quietThresholdSeconds) || quietThresholdSeconds <= 0) {
    throw new Error("quietThresholdSeconds must be positive");
  }

  let stats;
  try {
    stats = await lstat(resolve(indexedDbPath));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { state: "MISSING", cacheBytes: 0, fileCount: 0, metadataOnly: true };
    }
    throw error;
  }
  if (!stats.isDirectory()) throw new Error("Railway IndexedDB path must be a directory");

  const metadata = await collectMetadata(resolve(indexedDbPath));
  if (metadata.latestMtimeMs === undefined) {
    return { state: "EMPTY", cacheBytes: 0, fileCount: 0, metadataOnly: true };
  }
  const secondsSinceLastWrite = Math.max(
    0,
    Math.floor((nowMs - metadata.latestMtimeMs) / 1_000),
  );
  return {
    state: secondsSinceLastWrite <= quietThresholdSeconds ? "ACTIVE" : "QUIET",
    cacheBytes: metadata.bytes,
    fileCount: metadata.files,
    latestWriteAt: Math.floor(metadata.latestMtimeMs / 1_000),
    secondsSinceLastWrite,
    metadataOnly: true,
  };
};

export const compareRailwayCacheInspections = (
  initial: RailwayCacheInspection,
  current: RailwayCacheInspection,
): RailwayCacheObservation => ({
  initial,
  current,
  advanced:
    current.cacheBytes !== initial.cacheBytes ||
    current.fileCount !== initial.fileCount ||
    current.latestWriteAt !== initial.latestWriteAt,
});
