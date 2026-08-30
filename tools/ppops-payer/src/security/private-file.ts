import { constants, type Stats } from "node:fs";
import { lstat, open } from "node:fs/promises";

type PrivateFilePolicy = {
  label: string;
  maxBytes: number;
};

const validateMetadata = (
  metadata: Stats,
  path: string,
  policy: PrivateFilePolicy,
): void => {
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error(`${policy.label} must be a regular, non-symlink file: ${path}`);
  }
  if (metadata.size > policy.maxBytes) {
    throw new Error(`${policy.label} exceeds the ${policy.maxBytes}-byte limit: ${path}`);
  }
  if (process.platform !== "win32" && (metadata.mode & 0o077) !== 0) {
    throw new Error(`${policy.label} must not be accessible by group or others: ${path}`);
  }
  if (
    process.platform !== "win32" &&
    typeof process.getuid === "function" &&
    metadata.uid !== process.getuid()
  ) {
    throw new Error(`${policy.label} must be owned by the current user: ${path}`);
  }
};

const assertOwnerOnlyRegularFile = async (
  path: string,
  policy: PrivateFilePolicy,
): Promise<Stats> => {
  const metadata = await lstat(path);
  validateMetadata(metadata, path, policy);
  return metadata;
};

export const readOwnerOnlyFile = async (
  path: string,
  policy: PrivateFilePolicy,
): Promise<string> => {
  const beforeOpen = await assertOwnerOnlyRegularFile(path, policy);
  const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
  const handle = await open(path, constants.O_RDONLY | noFollow);
  try {
    const afterOpen = await handle.stat();
    validateMetadata(afterOpen, path, policy);
    if (beforeOpen.dev !== afterOpen.dev || beforeOpen.ino !== afterOpen.ino) {
      throw new Error(`${policy.label} changed while opening: ${path}`);
    }
    return await handle.readFile("utf8");
  } finally {
    await handle.close();
  }
};
