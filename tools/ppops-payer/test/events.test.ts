import { describe, expect, it } from "vitest";

import { SafeFailure, safeFailureResult } from "../src/events.js";

describe("safe failures", () => {
  it("never serializes error messages or causes", () => {
    const secret = "test test test test test test test test test test test junk";
    const result = safeFailureResult(
      new SafeFailure("PROOF_FAILED", `secret: ${secret}`, {
        cause: new Error(secret),
      }),
    );
    expect(result).toEqual({ ok: false, error: { code: "PROOF_FAILED" } });
    expect(JSON.stringify(result)).not.toContain(secret);
  });
});
