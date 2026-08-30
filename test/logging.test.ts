import { describe, expect, it } from "vitest";

import { classifyError } from "../src/logging.js";

describe("safe error classification", () => {
  it("classifies operational failures without returning their messages", () => {
    expect(classifyError(new Error("scan already in progress for secret endpoint"))).toBe(
      "CONCURRENT_SCAN",
    );
    expect(classifyError(new Error("RPC returned 429 for secret endpoint"))).toBe(
      "RPC_RATE_LIMITED",
    );
    expect(classifyError(new Error("RPC quorum could not agree on finalized block"))).toBe(
      "RPC_QUORUM",
    );
    expect(classifyError(new Error("RPC omitted the finalized block"))).toBe(
      "RPC_QUORUM",
    );
    expect(classifyError(new Error("database LOCK is already held"))).toBe(
      "STORAGE_LOCKED",
    );
    expect(classifyError(new Error("unrelated block processing failed"))).toBe(
      "SCAN_FAILED",
    );
    expect(classifyError(new Error("database checksum corruption"))).toBe(
      "STORAGE_CORRUPT",
    );
  });
});
