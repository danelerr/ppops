import {
  accessSync,
  constants,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { PPOpsConfigSchema } from "../src/config.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const skillRoot = resolve(root, "skills/ppops");

const onboardingMarkdown = [
  "README.md",
  "docs/QUICKSTART.md",
  "docs/MERCHANT-INTEGRATION.md",
  "docs/PAYER-INTEGRATION.md",
  "docs/DEPLOYMENT.md",
  "docs/SECURITY.md",
  "docs/TROUBLESHOOTING.md",
  "docs/ARCHITECTURE.md",
  "docs/EXTERNAL-PILOT.md",
  "skills/ppops/SKILL.md",
];

describe("onboarding layer", () => {
  it("ships a standards-shaped PPOps Agent Skill and all routed resources", () => {
    const skill = readFileSync(resolve(skillRoot, "SKILL.md"), "utf8");
    expect(skill).toMatch(/^---\nname: ppops\ndescription: [^\n]{1,1024}\n---\n/);

    for (const relativePath of [
      "agents/openai.yaml",
      "references/QUICKSTART.md",
      "references/API.md",
      "references/SECURITY.md",
      "references/PAYER.md",
      "references/TROUBLESHOOTING.md",
      "references/EXTERNAL-PILOT.md",
      "scripts/doctor.sh",
      "scripts/verify-install.sh",
      "scripts/smoke-test.sh",
      "assets/ppops.config.example.json",
    ]) {
      expect(() => accessSync(resolve(skillRoot, relativePath), constants.R_OK)).not.toThrow();
    }

    const interfaceMetadata = readFileSync(
      resolve(skillRoot, "agents/openai.yaml"),
      "utf8",
    );
    expect(interfaceMetadata).toContain("display_name: \"PPOps\"");
    expect(interfaceMetadata).toContain("$ppops");
  });

  it("keeps skill scripts executable, syntactically valid, and help-safe", () => {
    for (const name of ["doctor.sh", "verify-install.sh", "smoke-test.sh"]) {
      const path = resolve(skillRoot, "scripts", name);
      expect(statSync(path).mode & 0o111).not.toBe(0);
      expect(() => execFileSync("sh", ["-n", path])).not.toThrow();
      const help = execFileSync(path, ["--help"], { encoding: "utf8" });
      expect(help).toContain("Usage:");
    }
  });

  it("rejects a symlinked API token before the smoke test reads it", () => {
    const temporary = mkdtempSync(resolve(tmpdir(), "ppops-onboarding-"));
    try {
      const target = resolve(temporary, "api-token");
      const linked = resolve(temporary, "api-token-link");
      writeFileSync(target, "not-a-real-token\n", { mode: 0o600 });
      symlinkSync(target, linked);

      const result = spawnSync(
        resolve(skillRoot, "scripts/smoke-test.sh"),
        ["--api-token-file", linked],
        { encoding: "utf8" },
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("must not be a symlink");
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });

  it("does not parse a symlinked config during diagnostics", () => {
    const temporary = mkdtempSync(resolve(tmpdir(), "ppops-onboarding-"));
    try {
      const target = resolve(temporary, "ppops.config.target.json");
      const linked = resolve(temporary, "ppops.config.json");
      writeFileSync(target, "this must not be parsed\n", { mode: 0o600 });
      symlinkSync(target, linked);

      const result = spawnSync(
        resolve(skillRoot, "scripts/doctor.sh"),
        ["--repo", root, "--config", linked, "--offline"],
        { encoding: "utf8" },
      );
      expect(result.status).toBe(1);
    expect(result.stdout).toContain("FAIL  configuration");
      expect(result.stderr).not.toContain("SyntaxError");
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });

  it("keeps the skill config asset within the enforced v0.1 schema", () => {
    const config = JSON.parse(
      readFileSync(resolve(skillRoot, "assets/ppops.config.example.json"), "utf8"),
    ) as unknown;
    const parsed = PPOpsConfigSchema.safeParse(config);
    expect(parsed.success, parsed.success ? undefined : parsed.error.message).toBe(true);
  });

  it("keeps local onboarding links resolvable", () => {
    for (const relativePath of onboardingMarkdown) {
      const absolutePath = resolve(root, relativePath);
      const markdown = readFileSync(absolutePath, "utf8");
      const linkPattern = /\[[^\]]+\]\(([^)]+)\)/g;
      for (const match of markdown.matchAll(linkPattern)) {
        const target = match[1]?.split("#", 1)[0];
        if (
          !target ||
          target.startsWith("http://") ||
          target.startsWith("https://") ||
          target.startsWith("mailto:")
        ) {
          continue;
        }
        expect(
          () => accessSync(resolve(dirname(absolutePath), target), constants.F_OK),
          relativePath + " -> " + target,
        ).not.toThrow();
      }
    }
  });

  it("documents only commands exposed by the current CLIs", () => {
    const merchantHelp = execFileSync("node", ["dist/cli.js", "help"], {
      cwd: root,
      encoding: "utf8",
    });
    for (const command of ["init", "serve", "config-validate", "preflight", "backup"]) {
      expect(merchantHelp).toContain("ppops " + command);
    }

    // Payer process tests belong to its independent package. Merchant onboarding
    // must not require installing or building payer dependencies.
    const payerHelp = readFileSync(resolve(root, "tools/ppops-payer/src/cli.ts"), "utf8");
    for (const command of [
      "init",
      "config-validate",
      "secrets-check",
      "sync",
      "request-verify",
      "prepare-broadcaster",
      "pay-broadcaster",
      "recover-broadcaster",
    ]) {
      expect(payerHelp).toContain("ppops-payer " + command);
    }
  });
});
