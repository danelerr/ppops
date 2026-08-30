import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { isDirectExecution, main } from "../src/cli.js";
import { loadConfig } from "../src/config.js";
import { readSecret } from "../src/security/secrets.js";

const roots: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

describe("CLI initialization", () => {
  it("recognizes direct execution through an npm-style binary symlink", () => {
    const root = mkdtempSync(join(tmpdir(), "ppops-cli-link-test-"));
    roots.push(root);
    const targetDirectory = join(root, "package", "dist");
    const binDirectory = join(root, "node_modules", ".bin");
    mkdirSync(targetDirectory, { recursive: true });
    mkdirSync(binDirectory, { recursive: true });
    const target = join(targetDirectory, "cli.js");
    writeFileSync(target, "// fixture\n");
    const moduleUrl = pathToFileURL(target).href;

    expect(isDirectExecution(moduleUrl, target)).toBe(true);
    expect(isDirectExecution(moduleUrl, join(root, "missing"))).toBe(false);
    expect(isDirectExecution(moduleUrl, undefined)).toBe(false);

    if (process.platform !== "win32") {
      const link = join(binDirectory, "ppops");
      symlinkSync(target, link);
      expect(isDirectExecution(moduleUrl, link)).toBe(true);
    }
  });

  it("documents the complete mainnet evidence workflow", async () => {
    const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await main(["help"]);
    const help = output.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(help).toContain("mainnet-gate-replay");
    expect(help).toContain("mainnet-gate-snapshot");
    expect(help).toContain("mainnet-gate-verify");
    expect(help).toContain("mainnet-gate-report-verify");
  });

  it("creates file-based secrets and rejects spending-material options", async () => {
    const root = mkdtempSync(join(tmpdir(), "ppops-cli-test-"));
    roots.push(root);
    const viewingKeyFile = join(root, "merchant.viewing-key");
    writeFileSync(viewingKeyFile, `0zk-viewing-${"a".repeat(80)}\n`, { mode: 0o600 });
    if (process.platform !== "win32") chmodSync(viewingKeyFile, 0o600);
    const configPath = join(root, "instance", "ppops.config.json");
    const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await expect(
      main([
        "init",
        "--config",
        configPath,
        "--viewing-key-file",
        viewingKeyFile,
        "--token-address",
        "0x00000000000000000000000000000000000000A1",
        "--token-symbol",
        "TESTUSD",
        "--token-decimals",
        "6",
        "--rpc-url",
        "https://rpc.example",
        "--poi-node",
        "https://poi.example",
        "--spending-key",
        "must-never-be-accepted",
      ]),
    ).rejects.toThrow(/Unsupported option --spending-key/);
    expect(readFileSync(viewingKeyFile, "utf8")).not.toContain("must-never-be-accepted");

    await main([
      "init",
      "--config",
      configPath,
      "--viewing-key-file",
      viewingKeyFile,
      "--token-address",
      "0x00000000000000000000000000000000000000A1",
      "--token-symbol",
      "TESTUSD",
      "--token-decimals",
      "6",
      "--rpc-url",
      "https://rpc.example",
      "--poi-node",
      "https://poi.example",
    ]);

    const config = await loadConfig(configPath);
    expect(config.server.host).toBe("127.0.0.1");
    expect(config.network.chainId).toBe(11_155_111);
    expect(await readSecret(config.secrets.apiTokenFile, "api-token")).toHaveLength(43);
    expect(await readSecret(config.secrets.merchantSigningKeyFile, "merchant-private-key"))
      .toMatch(/^0x[0-9a-f]{64}$/);
    expect(output).toHaveBeenCalled();
  });
});
