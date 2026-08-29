import { describe, expect, it } from "vitest";
import { MerkletreeScanStatus } from "@railgun-community/shared-models";

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

  it("reports a live scan as stalled only after progress stops", () => {
    const startedAt = 1_000_000;
    const health = new ReconciliationHealth(60_000, startedAt, 600_000);
    health.scanStarted(startedAt);
    health.syncProgressUpdated({
      utxo: {
        status: MerkletreeScanStatus.Updated,
        progressRatio: 0.5,
        updatedAt: 1_000,
      },
      lastUpdatedAt: 1_000,
    });

    expect(health.snapshot(1_599_999).scanStalled).toBe(false);
    expect(health.snapshot(1_600_001).scanStalled).toBe(true);
  });

  it("does not carry stale progress into a new scan", () => {
    const health = new ReconciliationHealth(60_000, 1_000_000, 600_000);
    health.syncProgressUpdated({
      utxo: {
        status: MerkletreeScanStatus.Complete,
        progressRatio: 1,
        updatedAt: 1_000,
      },
      lastUpdatedAt: 1_000,
    });
    health.scanStarted(2_000_000);

    expect(health.snapshot(2_500_000).scanStalled).toBe(false);
    expect(health.snapshot(2_500_000).syncProgress).toBeUndefined();
  });

  it("reports a stall when the SDK never emits its first progress event", () => {
    const startedAt = 1_000_000;
    const health = new ReconciliationHealth(60_000, startedAt, 600_000);
    health.scanStarted(startedAt);

    expect(health.snapshot(1_599_999).scanStalled).toBe(false);
    expect(health.snapshot(1_600_001).scanStalled).toBe(true);
  });
});
