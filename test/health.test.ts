import { describe, expect, it } from "vitest";

import { ReconciliationHealth } from "../src/operations/health.js";

describe("reconciliation readiness", () => {
  it("fails closed before the first scan, after a failure and after staleness", () => {
    const startedAt = 1_000_000;
    const health = new ReconciliationHealth(60_000, startedAt);
    expect(health.snapshot(startedAt)).toMatchObject({
      railgunReady: false,
      scanInProgress: false,
      scansSucceeded: 0,
      scansFailed: 0,
    });

    health.scanStarted(startedAt + 1_000);
    expect(health.snapshot(startedAt + 1_500).scanInProgress).toBe(true);
    health.scanSucceeded(startedAt + 1_000, startedAt + 5_000);
    expect(health.snapshot(startedAt + 60_000)).toMatchObject({
      railgunReady: true,
      consecutiveFailures: 0,
      scansSucceeded: 1,
      lastScanDurationMs: 4_000,
    });
    expect(health.snapshot(startedAt + 65_001).railgunReady).toBe(false);

    health.scanStarted(startedAt + 70_000);
    health.scanFailed(startedAt + 70_000, startedAt + 72_000);
    expect(health.snapshot(startedAt + 72_000)).toMatchObject({
      railgunReady: false,
      scanInProgress: false,
      consecutiveFailures: 1,
      scansSucceeded: 1,
      scansFailed: 1,
      lastScanError: "SCAN_FAILED",
    });
  });
});
