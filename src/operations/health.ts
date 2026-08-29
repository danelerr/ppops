import type { RailgunSyncProgress } from "../railgun/engine.js";
import type { SafeErrorCode } from "../logging.js";

export type HealthState = {
  railgunReady: boolean;
  startedAt: number;
  scanInProgress: boolean;
  consecutiveFailures: number;
  scansSucceeded: number;
  scansFailed: number;
  lastScanDurationMs?: number;
  lastScanStartedAt?: number;
  lastScanAt?: number;
  lastScanError?: SafeErrorCode;
  syncProgress?: RailgunSyncProgress;
  scanStalled?: boolean;
};

export class ReconciliationHealth {
  private state: HealthState;

  constructor(
    private readonly maxStalenessMs: number,
    startedAtMs = Date.now(),
    private readonly scanStallThresholdMs = 1_200_000,
  ) {
    this.state = {
      railgunReady: false,
      startedAt: Math.floor(startedAtMs / 1_000),
      scanInProgress: false,
      consecutiveFailures: 0,
      scansSucceeded: 0,
      scansFailed: 0,
    };
  }

  syncProgressUpdated(progress: RailgunSyncProgress): void {
    this.state = { ...this.state, syncProgress: progress, scanStalled: false };
  }

  scanStarted(startedAtMs = Date.now()): void {
    this.state = {
      ...this.state,
      scanInProgress: true,
      lastScanStartedAt: Math.floor(startedAtMs / 1_000),
      syncProgress: undefined,
      scanStalled: false,
    };
  }

  scanSucceeded(startedAtMs: number, completedAtMs = Date.now()): void {
    this.state = {
      ...this.state,
      railgunReady: true,
      lastScanAt: Math.floor(completedAtMs / 1_000),
      lastScanDurationMs: Math.max(0, completedAtMs - startedAtMs),
      scanInProgress: false,
      consecutiveFailures: 0,
      scansSucceeded: this.state.scansSucceeded + 1,
      lastScanError: undefined,
    };
  }

  scanFailed(
    startedAtMs: number,
    failedAtMs = Date.now(),
    errorCode: SafeErrorCode = "SCAN_FAILED",
  ): void {
    this.state = {
      ...this.state,
      railgunReady: false,
      lastScanDurationMs: Math.max(0, failedAtMs - startedAtMs),
      scanInProgress: false,
      consecutiveFailures: this.state.consecutiveFailures + 1,
      scansFailed: this.state.scansFailed + 1,
      lastScanError: errorCode,
    };
  }

  snapshot(nowMs = Date.now()): HealthState {
    const stale =
      this.state.lastScanAt === undefined ||
      nowMs - this.state.lastScanAt * 1_000 > this.maxStalenessMs;
    const lastProgressAt = this.state.syncProgress?.lastUpdatedAt;
    const scanStalled =
      this.state.scanInProgress &&
      lastProgressAt !== undefined &&
      nowMs - lastProgressAt * 1_000 > this.scanStallThresholdMs;
    return {
      ...this.state,
      railgunReady: this.state.railgunReady && !stale,
      ...(this.state.scanInProgress ? { scanStalled } : { scanStalled: false }),
    };
  }
}
