import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { PPOPS_VERSION } from "../src/version.js";

const rootFile = (path: string): string =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("release version consistency", () => {
  it("keeps runtime, package metadata and container defaults aligned", () => {
    const packageJson = JSON.parse(rootFile("package.json")) as { version: string };
    const packageLock = JSON.parse(rootFile("package-lock.json")) as {
      version: string;
      packages: Record<string, { version?: string }>;
    };

    expect(packageJson.version).toBe(PPOPS_VERSION);
    expect(packageLock.version).toBe(PPOPS_VERSION);
    expect(packageLock.packages[""]?.version).toBe(PPOPS_VERSION);
    expect(rootFile("Dockerfile")).toContain(`ARG VERSION="${PPOPS_VERSION}"`);
    expect(rootFile("docker-compose.yml")).toContain(`PPOPS_IMAGE:-ppops:${PPOPS_VERSION}`);
  });
});
