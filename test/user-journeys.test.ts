import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.js";
import { diagnose, formatDiagnostics } from "../src/operations/doctor.js";
import { loadConfig, PPOpsConfigSchema } from "../src/config.js";
import { safeCliFailureResult } from "../src/security/failures.js";
import { PPOPS_VERSION } from "../src/version.js";

const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

const initialize = async () => {
  const directory = await mkdtemp(join(tmpdir(), "ppops-journey-"));
  directories.push(directory);
  const viewing = join(directory, "merchant.viewing-key");
  await writeFile(viewing, "fixture-view-only-" + "a".repeat(80), {
    mode: 0o600,
  });
  const configPath = join(directory, "instance", "ppops.config.json");
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  await main([
    "init",
    "--config",
    configPath,
    "--profile=arbitrum-usdc",
    "--viewing-key-file",
    viewing,
    "--rpc-url",
    "https://provider-a.example",
    "--rpc-url",
    "https://provider-b.example",
    "--poi-node",
    "https://poi.example",
  ]);
  return { directory, configPath };
};

describe("operator journeys", () => {
  it("provides help and version without a configuration or wallet", async () => {
    const write = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    await main(["--version"]);
    expect(write).toHaveBeenLastCalledWith(PPOPS_VERSION + "\n");
    for (const args of [
      ["init", "--help"],
      ["help", "init"],
      ["demo", "-h"],
      ["status", "--help"],
      ["doctor", "--help"],
    ])
      await expect(main(args)).resolves.toBeUndefined();
    expect(write.mock.calls.flat().join("")).toContain("arbitrum-usdc");
    await expect(main(["bogus-secret-must-not-be-echoed"])).rejects.toThrow(
      "Unknown command",
    );
  });

  it("initializes the documented profile and diagnoses each secret without a network", async () => {
    const { configPath } = await initialize();
    const config = await loadConfig(configPath);
    expect(config.network).toMatchObject({
      chainId: 42161,
      tokenSymbol: "USDC",
      tokenDecimals: 6,
      finality: { mode: "finalized" },
    });
    const preflight = vi.fn();
    const fetch = vi.fn();
    const result = await diagnose({
      configPath,
      offline: true,
      preflight,
      fetch,
    });
    expect(result.ok).toBe(true);
    expect(result.checks).toHaveLength(5);
    expect(preflight).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(formatDiagnostics(result)).toContain("PASS  secrets.viewingKeyFile");
    await rm(config.secrets.apiTokenFile);
    const failed = await diagnose({
      configPath,
      offline: true,
      preflight,
      fetch,
    });
    expect(
      failed.checks.find((check) => check.check === "secrets.apiTokenFile"),
    ).toMatchObject({ ok: false, code: "FILE_UNAVAILABLE" });
    expect(JSON.stringify(failed)).not.toContain(config.secrets.apiTokenFile);
  });

  it("distinguishes valid files, running scans and scan readiness", async () => {
    const { configPath } = await initialize();
    const preflight = vi.fn().mockResolvedValue({});
    const fetch = vi
      .fn()
      .mockResolvedValue(
        Response.json({
          railgunReady: false,
          scanInProgress: true,
          consecutiveFailures: 0,
        }),
      );
    const syncing = await diagnose({ configPath, preflight, fetch });
    expect(syncing.ok).toBe(false);
    expect(syncing.next).toContain("scan is running");
    expect(preflight).toHaveBeenCalledOnce();
    fetch.mockResolvedValue(
      Response.json({
        railgunReady: true,
        scanInProgress: false,
        consecutiveFailures: 0,
      }),
    );
    const ready = await diagnose({
      configPath,
      statusOnly: true,
      preflight,
      fetch,
    });
    expect(ready.ok).toBe(true);
    expect(ready.checks).toHaveLength(2);
    expect(ready.next).toContain("Ready");
    const missing = await diagnose({
      configPath: configPath + ".missing",
      offline: true,
      preflight,
      fetch,
    });
    expect(missing.ok).toBe(false);
    expect(missing.checks[0]?.check).toBe("configuration");
  });

  it("identifies known configuration fields without echoing unknown field names or values", async () => {
    const { configPath } = await initialize();
    const config = await loadConfig(configPath);
    const parsed = PPOpsConfigSchema.safeParse({
      ...config,
      network: { ...config.network, tokenDecimals: -1 },
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const result = safeCliFailureResult(parsed.error);
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({ field: "network.tokenDecimals" }),
      );
      expect(JSON.stringify(result)).not.toContain("provider-a.example");
    }
  });
});
