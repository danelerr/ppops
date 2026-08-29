import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { access, chmod, lstat, mkdir, open, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { Mnemonic } from "ethers";

export type SecretKind = "db-encryption-key" | "mnemonic" | "evm-private-key";

const exists = async (path: string): Promise<boolean> => {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
};

export const assertPrivateFile = async (path: string): Promise<void> => {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error(`Secret path must be a regular, non-symlink file: ${path}`);
  }
  if (metadata.size > 4_096) throw new Error(`Secret file is unexpectedly large: ${path}`);
  if (process.platform !== "win32" && (metadata.mode & 0o077) !== 0) {
    throw new Error(`Secret file must not be accessible by group or others: ${path}`);
  }
  if (
    process.platform !== "win32" &&
    typeof process.getuid === "function" &&
    metadata.uid !== process.getuid()
  ) {
    throw new Error(`Secret file must be owned by the current user: ${path}`);
  }
};

const normalizeMnemonic = (value: string): string => value.trim().replace(/\s+/g, " ");

const validateSecret = (raw: string, kind: SecretKind, path: string): string => {
  const value = kind === "mnemonic" ? normalizeMnemonic(raw) : raw.trim();
  const invalid = (): never => {
    throw new Error(`Invalid ${kind} in secret file: ${path}`);
  };
  if (kind === "db-encryption-key" && !/^[0-9a-f]{64}$/i.test(value)) invalid();
  if (kind === "evm-private-key" && !/^0x[0-9a-f]{64}$/i.test(value)) invalid();
  if (kind === "mnemonic") {
    const wordCount = value.split(" ").length;
    if ((wordCount !== 12 && wordCount !== 24) || !Mnemonic.isValidMnemonic(value)) {
      invalid();
    }
  }
  return value;
};

export const readSecret = async (path: string, kind: SecretKind): Promise<string> => {
  await assertPrivateFile(path);
  const noFollow = "O_NOFOLLOW" in constants ? constants.O_NOFOLLOW : 0;
  const handle = await open(path, constants.O_RDONLY | noFollow);
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size > 4_096) {
      throw new Error(`Secret path changed while opening: ${path}`);
    }
    return validateSecret(await handle.readFile("utf8"), kind, path);
  } finally {
    await handle.close();
  }
};

export const writeNewSecret = async (path: string, value: string): Promise<void> => {
  if (await exists(path)) throw new Error(`Refusing to overwrite secret file: ${path}`);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${value}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await chmod(path, 0o600);
};

export const generateDbEncryptionKey = (): string => randomBytes(32).toString("hex");
