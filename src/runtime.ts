import { loadConfig, type PPOpsConfig } from "./config.js";
import { PPOpsDatabase } from "./db/database.js";
import type { NormalizedSettlement } from "./domain.js";
import { WebhookDeliveryService } from "./events/webhook.js";
import { IntentService } from "./intents/service.js";
import { RailgunViewOnlyEngine } from "./railgun/engine.js";
import { RailgunScanner } from "./railgun/scanner.js";
import { ReconciliationService } from "./reconciliation/service.js";
import { readSecret } from "./security/secrets.js";
import { RuntimeLock, runtimeLockPath } from "./security/runtime-lock.js";
import { logInfo } from "./logging.js";

export type ScanResult = {
  discovered: number;
  reconciled: number;
  rechecked: number;
  projectionsChanged: number;
  webhookDelivered: number;
  webhookFailed: number;
};

export class PPOpsRuntime {
  readonly reconciliation: ReconciliationService;
  readonly intents: IntentService;
  private stopped = false;

  private constructor(
    readonly config: PPOpsConfig,
    readonly database: PPOpsDatabase,
    readonly engine: RailgunViewOnlyEngine,
    readonly scanner: RailgunScanner,
    readonly apiToken: string,
    private readonly lock: RuntimeLock,
    readonly webhook?: WebhookDeliveryService,
    intents?: IntentService,
  ) {
    if (!intents) throw new Error("Intent service is required");
    this.intents = intents;
    this.reconciliation = new ReconciliationService(database);
  }

  static async create(configPath: string): Promise<PPOpsRuntime> {
    logInfo("startup.config_loading");
    const config = await loadConfig(configPath);
    const [apiToken, merchantPrivateKey, dbEncryptionKey, viewingKey] =
      await Promise.all([
        readSecret(config.secrets.apiTokenFile, "api-token"),
        readSecret(config.secrets.merchantSigningKeyFile, "merchant-private-key"),
        readSecret(
          config.secrets.railgunDbEncryptionKeyFile,
          "railgun-db-encryption-key",
        ),
        readSecret(config.secrets.viewingKeyFile, "viewing-key"),
      ]);
    const engine = new RailgunViewOnlyEngine(config, dbEncryptionKey, viewingKey);
    logInfo("startup.secrets_validated");
    const lock = await RuntimeLock.acquire(runtimeLockPath(config.storage.sqlitePath));
    let database: PPOpsDatabase | undefined;
    let scanner: RailgunScanner | undefined;
    try {
      logInfo("startup.wallet_initializing");
      await engine.start();
      logInfo("startup.wallet_initialized");
      database = new PPOpsDatabase(config.storage.sqlitePath);
      scanner = new RailgunScanner(engine, config);
      const intents = new IntentService(
        database,
        config.network,
        engine.railgunAddress,
        merchantPrivateKey,
      );
      let webhook: WebhookDeliveryService | undefined;
      if (config.webhook) {
        const keyPath = config.secrets.webhookHmacKeyFile;
        if (!keyPath) throw new Error("Webhook HMAC key path is missing");
        const webhookKey = await readSecret(keyPath, "webhook-hmac-key");
        webhook = new WebhookDeliveryService(database, config.webhook, webhookKey);
      }
      return new PPOpsRuntime(
        config,
        database,
        engine,
        scanner,
        apiToken,
        lock,
        webhook,
        intents,
      );
    } catch (error) {
      await scanner?.close().catch(() => undefined);
      database?.close();
      await engine.stop().catch(() => undefined);
      await lock.release().catch(() => undefined);
      throw error;
    }
  }

  async scanOnce(now = Math.floor(Date.now() / 1_000)): Promise<ScanResult> {
    if (this.stopped) throw new Error("PPOps runtime is stopped");
    const maintenanceBefore = await this.maintenanceOnce(now);
    const candidates = await this.scanner.scan();
    const seen = new Set<string>();
    for (const candidate of candidates) {
      seen.add(candidate.uniqueSettlementId);
      this.reconciliation.reconcile(candidate, now);
    }

    let rechecked = 0;
    for (
      const settlement of this.database.listChainStateRecheckCandidates(
        now,
        this.config.scanner.finalizedRecheckSeconds,
      )
    ) {
      if (seen.has(settlement.uniqueSettlementId)) continue;
      const refreshed: NormalizedSettlement =
        await this.scanner.refreshKnownChainState(settlement);
      this.reconciliation.reconcile(refreshed, now);
      rechecked += 1;
    }
    const maintenanceAfter = await this.maintenanceOnce(now);
    return {
      discovered: candidates.length,
      reconciled: candidates.length,
      rechecked,
      projectionsChanged:
        maintenanceBefore.projectionsChanged + maintenanceAfter.projectionsChanged,
      webhookDelivered:
        maintenanceBefore.webhookDelivered + maintenanceAfter.webhookDelivered,
      webhookFailed: maintenanceBefore.webhookFailed + maintenanceAfter.webhookFailed,
    };
  }

  async maintenanceOnce(now = Math.floor(Date.now() / 1_000)): Promise<{
    projectionsChanged: number;
    webhookDelivered: number;
    webhookFailed: number;
  }> {
    if (this.stopped) throw new Error("PPOps runtime is stopped");
    const projectionsChanged = this.reconciliation.refreshExpirations(now);
    const delivery = this.webhook
      ? await this.webhook.deliverPending(now)
      : { delivered: 0, failed: 0, deadLettered: 0 };
    return {
      projectionsChanged,
      webhookDelivered: delivery.delivered,
      webhookFailed: delivery.failed + delivery.deadLettered,
    };
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    let firstError: unknown;
    try {
      await this.scanner.close();
    } catch (error) {
      firstError = error;
    }
    try {
      await this.engine.stop();
    } catch (error) {
      firstError ??= error;
    }
    try {
      this.database.close();
    } catch (error) {
      firstError ??= error;
    } finally {
      try {
        await this.lock.release();
      } catch (error) {
        firstError ??= error;
      }
    }
    if (firstError) throw firstError;
  }
}
