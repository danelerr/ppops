import { constants } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";

import { ArtifactStore } from "@railgun-community/wallet";

const exists = async (path: string): Promise<boolean> => {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
};

const safeArtifactPath = (root: string, path: string): string => {
  const normalizedRoot = resolve(root);
  const candidate = resolve(normalizedRoot, path);
  if (candidate !== normalizedRoot && !candidate.startsWith(`${normalizedRoot}${sep}`)) {
    throw new Error("RAILGUN artifact path escaped the configured directory");
  }
  return candidate;
};

export const createArtifactStore = (root: string): ArtifactStore =>
  new ArtifactStore(
    async (path) => {
      const target = safeArtifactPath(root, path);
      try {
        return await readFile(target);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        return null;
      }
    },
    async (directory, path, data) => {
      await mkdir(safeArtifactPath(root, directory), { recursive: true, mode: 0o700 });
      await writeFile(safeArtifactPath(root, path), data, { mode: 0o600 });
    },
    async (path) => exists(safeArtifactPath(root, path)),
  );
