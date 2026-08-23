import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { randomBytes } from "node:crypto";

import leveldown, { type LevelDown } from "leveldown";
import {
  ArtifactStore,
  startRailgunEngine,
  stopRailgunEngine,
} from "@railgun-community/wallet";
import type { FallbackProviderJsonConfig } from "@railgun-community/shared-models";

export const STATE_ROOT = resolve(
  process.env.PPOPS_KILL_STATE_DIR ?? ".ppops-kill-test",
);

export const DEFAULT_POI_NODE = "https://ppoi-agg.horsewithsixlegs.xyz";

const exists = async (path: string): Promise<boolean> => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

export const createArtifactStore = (root: string): ArtifactStore =>
  new ArtifactStore(
    async (path) => {
      try {
        return await readFile(join(root, path));
      } catch {
        return null;
      }
    },
    async (dir, path, data) => {
      await mkdir(join(root, dir), { recursive: true });
      await writeFile(join(root, path), data);
    },
    async (path) => exists(join(root, path)),
  );

export const ensureHexSecretFile = async (path: string): Promise<string> => {
  if (!(await exists(path))) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, randomBytes(32).toString("hex"), { mode: 0o600 });
  }
  const value = (await readFile(path, "utf8")).trim();
  if (!/^[0-9a-f]{64}$/i.test(value)) {
    throw new Error(`Expected a 32-byte hex secret in ${path}`);
  }
  return value;
};

export const readSecretFile = async (path: string): Promise<string> => {
  const value = (await readFile(path, "utf8")).trim();
  if (value.length === 0) {
    throw new Error(`Secret file is empty: ${path}`);
  }
  return value;
};

export const publicSepoliaProviderConfig = (): FallbackProviderJsonConfig => ({
  chainId: 11155111,
  providers: [
    {
      provider:
        process.env.PPOPS_RAILGUN_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com",
      priority: 1,
      weight: 2,
      maxLogsPerBatch: 5,
      stallTimeout: 3_000,
    },
    {
      provider: "https://sepolia.drpc.org",
      priority: 2,
      weight: 1,
      maxLogsPerBatch: 2,
      stallTimeout: 3_000,
    },
  ],
});

export const startEngine = async (args: {
  dbPath: string;
  artifactsPath: string;
  skipMerkletreeScans: boolean;
  withTestPOINode: boolean;
}): Promise<void> => {
  await mkdir(dirname(args.dbPath), { recursive: true });
  await mkdir(args.artifactsPath, { recursive: true });
  const createLevelDown = leveldown as unknown as (location: string) => LevelDown;
  const db = createLevelDown(args.dbPath);
  const poiNodeURLs = args.withTestPOINode
    ? [process.env.PPOPS_POI_NODE_URL ?? DEFAULT_POI_NODE]
    : undefined;

  await startRailgunEngine(
    "ppops killtest",
    db,
    false,
    createArtifactStore(args.artifactsPath),
    false,
    args.skipMerkletreeScans,
    poiNodeURLs,
    [],
    false,
  );
};

export const stopEngine = async (): Promise<void> => {
  await stopRailgunEngine();
};
