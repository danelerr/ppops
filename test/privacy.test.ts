import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("generated privacy evidence", () => {
  it("records only passing, accurately scoped privacy claims", async () => {
    const report = JSON.parse(
      await readFile(resolve("artifacts/privacy-report.json"), "utf8"),
    ) as {
      result: string;
      tests: Record<string, string>;
      limitations: string[];
    };
    expect(report.result).toBe("PASS");
    expect(Object.values(report.tests)).not.toContain("FAIL");
    expect(report.tests.referenceRecoveredByAuthorizedReceiverViewingCapability).toBe("PASS");
    expect(report.tests.signatureGenerationRejectedByViewOnlyWallet).toBe("PASS");
    expect(report.limitations).toContain(
      "Sender and authorized receiver viewing capabilities can decrypt the RAILGUN memo.",
    );
  });
});
