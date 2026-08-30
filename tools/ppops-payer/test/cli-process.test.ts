import { execFile } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true })));
});

describe("CLI process lifecycle", () => {
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
      stdout: '{"ok":false,"error":{"code":"INTERNAL_ERROR"}}\n',
      stderr: "",
    });
  });
});
