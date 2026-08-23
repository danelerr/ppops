import { serve, type ServerType } from "@hono/node-server";

import { createApiApp, type HealthState } from "./app.js";
import { logError, logInfo } from "../logging.js";
import { PPOpsRuntime, type ScanResult } from "../runtime.js";

const closeServer = (server: ServerType): Promise<void> =>
  new Promise((resolve, reject) => {
    server.close((error?: Error & { code?: string }) =>
      error && error.code !== "ERR_SERVER_NOT_RUNNING" ? reject(error) : resolve(),
    );
  });

export class PPOpsDaemon {
  private server?: ServerType;
  private scanTimer?: NodeJS.Timeout;
  private activeScan?: Promise<void>;
  private stopping = false;
  private health: HealthState = { railgunReady: true };
  readonly failure: Promise<never>;
  private rejectFailure!: (error: unknown) => void;

  constructor(readonly runtime: PPOpsRuntime) {
    this.failure = new Promise<never>((_resolve, reject) => {
      this.rejectFailure = reject;
    });
  }

  start(): void {
    if (this.server) throw new Error("PPOps daemon is already started");
    const app = createApiApp({
      intents: this.runtime.intents,
      database: this.runtime.database,
      apiToken: this.runtime.apiToken,
      health: () => ({ ...this.health }),
    });
    this.server = serve(
      {
        fetch: app.fetch,
        hostname: this.runtime.config.server.host,
        port: this.runtime.config.server.port,
      },
      (info) => {
        logInfo("api.listening", { address: info.address, port: info.port });
      },
    );
    if ("requestTimeout" in this.server) this.server.requestTimeout = 30_000;
    if ("headersTimeout" in this.server) this.server.headersTimeout = 10_000;
    if ("keepAliveTimeout" in this.server) this.server.keepAliveTimeout = 5_000;
    if ("maxHeadersCount" in this.server) this.server.maxHeadersCount = 100;
    this.server.once("error", (error) => {
      logError("api.failed", error);
      this.rejectFailure(error);
    });
    this.scheduleScan(0);
  }

  async stop(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    if (this.scanTimer) clearTimeout(this.scanTimer);
    if (this.server) await closeServer(this.server);
    if (this.activeScan) {
      await Promise.race([
        this.activeScan,
        new Promise<void>((resolve) => setTimeout(resolve, 15_000)),
      ]);
    }
    await this.runtime.stop();
    logInfo("daemon.stopped");
  }

  private scheduleScan(delayMs: number): void {
    if (this.stopping) return;
    this.scanTimer = setTimeout(() => {
      this.activeScan = this.executeScan().finally(() => {
        this.activeScan = undefined;
        this.scheduleScan(this.runtime.config.scanner.intervalMs);
      });
    }, delayMs);
  }

  private async executeScan(): Promise<void> {
    try {
      const result: ScanResult = await this.runtime.scanOnce();
      this.health = {
        railgunReady: true,
        lastScanAt: Math.floor(Date.now() / 1_000),
      };
      logInfo("scan.completed", result);
    } catch (error) {
      this.health = {
        ...this.health,
        railgunReady: true,
        lastScanError: "SCAN_FAILED",
      };
      logError("scan.failed", error);
    }
  }
}
