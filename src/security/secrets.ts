import { randomBytes } from "node:crypto";
import { access, chmod, mkdir, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname } from "node:path";

import { readOwnerOnlyFile } from "./private-file.js";

type SecretKind =
  | "api-token"
  | "merchant-private-key"
  | "railgun-db-encryption-key"
  | "viewing-key"
  | "webhook-hmac-key";

const exists = async (path: string): Promise<boolean> => {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
};

const validateSecret = (value: string, kind: SecretKind, path: string): string => {
  const fail = (): never => {
    throw new Error(`Invalid ${kind} in secret file: ${path}`);
  };
  switch (kind) {
    case "api-token":
      if (!/^[A-Za-z0-9_-]{43,128}$/.test(value)) fail();
      break;
    case "merchant-private-key":
      if (!/^0x[0-9a-f]{64}$/i.test(value)) fail();
      break;
    case "railgun-db-encryption-key":
    case "webhook-hmac-key":
      if (!/^[0-9a-f]{64}$/i.test(value)) fail();
      break;
    case "viewing-key":
      if (value.length < 32 || /\s/.test(value)) fail();
      break;
  }
  return value;
};

export const readSecret = async (path: string, kind: SecretKind): Promise<string> => {
  const value = (
    await readOwnerOnlyFile(path, { label: "Secret file", maxBytes: 4_096 })
  ).trim();
  return validateSecret(value, kind, path);
};

export const writeNewSecret = async (path: string, value: string): Promise<void> => {
  if (await exists(path)) throw new Error(`Refusing to overwrite secret file: ${path}`);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${value}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await chmod(path, 0o600);
};

export const generateApiToken = (): string => randomBytes(32).toString("base64url");
export const generateHexKey = (): string => randomBytes(32).toString("hex");
export const generatePrivateKey = (): string => `0x${generateHexKey()}`;
