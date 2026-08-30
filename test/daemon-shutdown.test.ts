import { describe, expect, it, vi } from "vitest";

import { PPOpsDaemon } from "../src/api/server.js";
import type { PPOpsRuntime } from "../src/runtime.js";

describe("daemon shutdown", () => {
  it("drains an active non-cancellable scan before closing runtime state", async () => {
    let finishScan: (() => void) | undefined;
    const activeScan = new Promise<void>((resolve) => {
      finishScan = resolve;
    });
    const stop = vi.fn(async () => undefined);
    const runtime = {
      config: {
        scanner: {
          intervalMs: 30_000,
          scanStallThresholdMs: 1_200_000,
        },
      },
      engine: {
        onSyncProgress: vi.fn(() => () => undefined),
      },
      stop,
    } as unknown as PPOpsRuntime;
    const daemon = new PPOpsDaemon(runtime);
    (daemon as unknown as { activeScan?: Promise<void> }).activeScan = activeScan;

    const stopping = daemon.stop();
    await Promise.resolve();
    expect(stop).not.toHaveBeenCalled();

    finishScan?.();
    await stopping;
    expect(stop).toHaveBeenCalledOnce();
  });
});
