import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { RailgunEngine } from "@railgun-community/engine";
import { afterEach, describe, expect, it } from "vitest";

import { PAYER_DEPLOYMENT_BLOCK } from "../src/constants.js";

const execFileAsync = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true })));
});

describe("CLI process lifecycle", () => {
  it("supports per-command help and version before reading configuration", async () => {
    for (const args of [["init", "--help"], ["help", "prepare-broadcaster"], ["recover-broadcaster", "-h"], ["--version"]]) {
      const result = await execFileAsync(process.execPath, ["--import", "tsx", "src/cli.ts", ...args], { cwd: process.cwd(), timeout: 5000 });
      expect(result.stderr).toBe("");
      expect(result.stdout).not.toContain('"ok":false');
      expect(result.stdout.trim().length).toBeGreaterThan(0);
    }
  });
  it("flushes help output and exits cleanly", async () => {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      ["--import", "tsx", "src/cli.ts", "--help"],
      { cwd: process.cwd(), timeout: 5_000 },
    );

    expect(stdout).toContain("ppops-payer");
    expect(stdout).toContain("prepare-self-signed");
    expect(stdout).toContain("prepare-broadcaster");
    expect(stdout).toContain("recover-broadcaster");
    expect(stdout).toContain("finalize-poi");
    expect(stderr).toBe("");
  });

  it("writes a private, operator-pinned Broadcaster trust config", async () => {
    const root = await mkdtemp(join(tmpdir(), "ppops-broadcaster-cli-"));
    roots.push(root);
    const outputPath = join(root, "broadcaster.config.json");
    const trustedSigner =
      "0zk1qyjyhqjdkqd9qxusgj092ppxl92plvrk3s3cna9u73h5rwt0ghxvfrv7j6fe3z53l7lrzyqw5te7ku5v8fsrpeadzvpkudgawjv9dg08htj7z3mph5kd6dw50jc";
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [
        "--import",
        "tsx",
        "src/cli.ts",
        "broadcaster-config-init",
        "--output",
        outputPath,
        "--trusted-fee-signer",
        trustedSigner,
      ],
      { cwd: process.cwd(), timeout: 5_000 },
    );

    expect(stderr).toBe("");
    expect(stdout).not.toContain(trustedSigner);
    expect(JSON.parse(stdout)).toMatchObject({
      ok: true,
      trustedFeeSignerCount: 1,
      valuesSourcePinnedByOperator: true,
    });
    if (process.platform !== "win32") {
      expect((await stat(outputPath)).mode & 0o777).toBe(0o600);
    }
  });

  it("flushes a safe error and exits non-zero", async () => {
    await expect(
      execFileAsync(
        process.execPath,
        ["--import", "tsx", "src/cli.ts", "unknown-command"],
        {
          cwd: process.cwd(),
          timeout: 5_000,
        },
      ),
    ).rejects.toMatchObject({
      code: 1,
      stdout: '{"ok":false,"error":{"code":"INVALID_ARGUMENT","hint":"Unknown command. Run ppops-payer --help."}}\n',
      stderr: "",
    });
  });

  it("rejects the wrong expected payer before trusting terminal Broadcaster state", async () => {
    const root = await mkdtemp(join(tmpdir(), "ppops-broadcaster-recovery-cli-"));
    roots.push(root);
    const configPath = join(root, "payer.config.json");
    const dataPath = join(root, "data");
    const walletStatePath = join(dataPath, "wallet-state.json");
    const journalPath = `${walletStatePath}.submissions.json`;
    const payer = RailgunEngine.encodeAddress({
      masterPublicKey: 1n,
      viewingPublicKey: new Uint8Array(32).fill(1),
    });
    const wrongPayer = RailgunEngine.encodeAddress({
      masterPublicKey: 2n,
      viewingPublicKey: new Uint8Array(32).fill(2),
    });
    const intentId = `pi_${"12".repeat(16)}`;
    const transactionHash = `0x${"33".repeat(32)}`;
    await mkdir(dataPath, { recursive: true, mode: 0o700 });
    await writeFile(
      configPath,
      `${JSON.stringify({
        schemaVersion: 1,
        network: {
          railgunNetworkName: "Arbitrum",
          chainId: 42_161,
          tokenAddress: "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
          tokenSymbol: "USDC",
          tokenDecimals: 6,
          deploymentBlock: PAYER_DEPLOYMENT_BLOCK,
          walletCreationBlock: PAYER_DEPLOYMENT_BLOCK,
          rpcUrls: ["https://rpc-one.example", "https://rpc-two.example"],
        },
        poiNodeUrls: ["https://poi.example"],
        storage: {
          railgunDbPath: "./data/railgun-db",
          artifactsPath: "./data/artifacts",
          walletStatePath: "./data/wallet-state.json",
        },
        secrets: {
          dbEncryptionKeyFile: "./secrets/db-key",
          mnemonicFile: "./secrets/mnemonic",
          selfSigningKeyFile: "./secrets/evm-key",
        },
        scanner: { providerPollingIntervalMs: 10_000 },
      })}\n`,
      { mode: 0o600 },
    );
    await writeFile(
      journalPath,
      `${JSON.stringify({
        schemaVersion: 1,
        records: [
          {
            intentId,
            requestFingerprint: "11".repeat(32),
            submissionMode: "BROADCASTER",
            payerRailgunAddress: payer,
            broadcasterRailgunAddress: payer,
            broadcasterQuoteFingerprint: "22".repeat(32),
            broadcasterFeesIDFingerprint: "33".repeat(32),
            broadcasterFeeAmountAtomic: "1",
            nullifiers: [`0x${"44".repeat(32)}`],
            reportedTransactionHash: transactionHash,
            status: "MINED",
            createdAt: 1,
            updatedAt: 2,
            transactionHash,
            blockNumber: 3,
          },
        ],
      })}\n`,
      { mode: 0o600 },
    );

    await expect(
      execFileAsync(
        process.execPath,
        [
          "--import",
          "tsx",
          "src/cli.ts",
          "recover-broadcaster",
          "--config",
          configPath,
          "--intent-id",
          intentId,
          "--expected-payer",
          wrongPayer,
        ],
        { cwd: process.cwd(), timeout: 5_000 },
      ),
    ).rejects.toMatchObject({
      code: 1,
      stdout: '{"ok":false,"error":{"code":"SECRET_INVALID"}}\n',
      stderr: "",
    });
  });
});
