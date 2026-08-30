import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("CLI process lifecycle", () => {
  it("flushes help output and exits cleanly", async () => {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      ["--import", "tsx", "src/cli.ts", "--help"],
      { cwd: process.cwd(), timeout: 5_000 },
    );

    expect(stdout).toContain("ppops-payer");
    expect(stdout).toContain("prepare-self-signed");
    expect(stdout).toContain("finalize-poi");
    expect(stderr).toBe("");
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
