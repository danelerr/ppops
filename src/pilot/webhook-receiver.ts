import { createHash } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import Database from "better-sqlite3";
import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { z } from "zod";

import { verifyWebhookSignature } from "../events/webhook.js";

type StoredWebhook = { payload_hash: string };

const AtomicAmountSchema = z.string().regex(/^(?:0|[1-9][0-9]*)$/);
const EventEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(1),
    eventId: z.string().regex(/^evt_[0-9a-f]{32}$/),
    type: z.enum([
      "settlement.observed",
      "payment.partial",
      "payment.confirmed",
      "payment.expired",
      "payment.reverted",
    ]),
    occurredAt: z.number().int().nonnegative(),
    intentId: z.string().min(1).max(128),
    settlementId: z.string().min(1).max(512).optional(),
    intentStatus: z.enum(["OPEN", "PARTIAL", "PAID", "EXPIRED", "PAID_LATE"]),
    receivedAmountAtomic: AtomicAmountSchema,
    expectedAmountAtomic: AtomicAmountSchema,
    overpaymentAmountAtomic: AtomicAmountSchema,
  })
  .strict();

export class PilotWebhookStore {
  private readonly database: Database.Database;

  constructor(path: string) {
    const resolved = resolve(path);
    mkdirSync(dirname(resolved), { recursive: true, mode: 0o700 });
    this.database = new Database(resolved);
    if (process.platform !== "win32") chmodSync(resolved, 0o600);
    this.database.pragma("journal_mode = WAL");
    this.database.pragma("synchronous = FULL");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS received_webhook (
        event_id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        received_at INTEGER NOT NULL,
        delivery_count INTEGER NOT NULL DEFAULT 1
      ) STRICT
    `);
    const columns = this.database
      .prepare("PRAGMA table_info(received_webhook)")
      .all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === "delivery_count")) {
      this.database.exec(
        "ALTER TABLE received_webhook ADD COLUMN delivery_count INTEGER NOT NULL DEFAULT 1",
      );
    }
  }

  accept(
    eventId: string,
    eventType: string,
    payloadHash: string,
    receivedAt: number,
  ): "accepted" | "duplicate" | "conflict" {
    return this.database.transaction(() => {
      const existing = this.database
        .prepare("SELECT payload_hash FROM received_webhook WHERE event_id = ?")
        .get(eventId) as StoredWebhook | undefined;
      if (existing) {
        if (existing.payload_hash !== payloadHash) return "conflict";
        this.database
          .prepare(
            "UPDATE received_webhook SET delivery_count = delivery_count + 1 WHERE event_id = ?",
          )
          .run(eventId);
        return "duplicate";
      }
      this.database
        .prepare(
          "INSERT INTO received_webhook (event_id, event_type, payload_hash, received_at) VALUES (?, ?, ?, ?)",
        )
        .run(eventId, eventType, payloadHash, receivedAt);
      return "accepted";
    })();
  }

  count(): number {
    const result = this.database
      .prepare("SELECT COUNT(*) AS count FROM received_webhook")
      .get() as { count: number };
    return result.count;
  }

  deliveryCount(): number {
    const result = this.database
      .prepare("SELECT COALESCE(SUM(delivery_count), 0) AS count FROM received_webhook")
      .get() as { count: number };
    return result.count;
  }

  countsByType(): Record<string, number> {
    const rows = this.database
      .prepare(
        "SELECT event_type, COUNT(*) AS count FROM received_webhook GROUP BY event_type ORDER BY event_type",
      )
      .all() as Array<{ event_type: string; count: number }>;
    return Object.fromEntries(rows.map((row) => [row.event_type, row.count]));
  }

  deliveryCountsByType(): Record<string, number> {
    const rows = this.database
      .prepare(
        "SELECT event_type, SUM(delivery_count) AS count FROM received_webhook GROUP BY event_type ORDER BY event_type",
      )
      .all() as Array<{ event_type: string; count: number }>;
    return Object.fromEntries(rows.map((row) => [row.event_type, row.count]));
  }

  close(): void {
    this.database.close();
  }
}

export const createPilotWebhookReceiverApp = (dependencies: {
  hmacKeyHex: string;
  keyId: string;
  store: PilotWebhookStore;
  now?: () => number;
}): Hono => {
  const app = new Hono();
  app.use("*", secureHeaders());
  app.use("*", async (context, next) => {
    context.header("cache-control", "no-store");
    await next();
  });
  app.get("/live", (context) => context.json({ status: "alive" }));
  app.get("/stats", (context) => {
    const receivedEventCount = dependencies.store.count();
    const deliveryAttemptCount = dependencies.store.deliveryCount();
    const receivedEventsByType = dependencies.store.countsByType();
    const deliveryAttemptsByType = dependencies.store.deliveryCountsByType();
    const duplicateDeliveriesByType = Object.fromEntries(
      Object.entries(deliveryAttemptsByType).map(([eventType, attempts]) => [
        eventType,
        attempts - (receivedEventsByType[eventType] ?? 0),
      ]),
    );
    return context.json({
      receivedEventCount,
      deliveryAttemptCount,
      duplicateDeliveryCount: deliveryAttemptCount - receivedEventCount,
      receivedEventsByType,
      deliveryAttemptsByType,
      duplicateDeliveriesByType,
      storesPayloads: false,
    });
  });
  app.post("/webhooks/ppops", async (context) => {
    const contentType = context.req
      .header("content-type")
      ?.split(";", 1)[0]
      ?.trim()
      .toLowerCase();
    if (contentType !== "application/json") {
      return context.json({ error: { code: "UNSUPPORTED_MEDIA_TYPE" } }, 415);
    }
    const payloadJson = await context.req.text();
    if (Buffer.byteLength(payloadJson, "utf8") > 64 * 1024) {
      return context.json({ error: { code: "REQUEST_TOO_LARGE" } }, 413);
    }
    const timestampText = context.req.header("ppops-timestamp") ?? "";
    const timestamp = /^[0-9]{1,12}$/.test(timestampText)
      ? Number(timestampText)
      : Number.NaN;
    const eventId = context.req.header("ppops-event-id") ?? "";
    const keyId = context.req.header("ppops-key-id") ?? "";
    const signature = context.req.header("ppops-signature") ?? "";
    const now = dependencies.now?.() ?? Math.floor(Date.now() / 1_000);
    if (
      keyId !== dependencies.keyId ||
      !verifyWebhookSignature({
        hmacKeyHex: dependencies.hmacKeyHex,
        timestamp,
        eventId,
        keyId,
        payloadJson,
        signature,
        now,
      })
    ) {
      return context.json({ error: { code: "INVALID_SIGNATURE" } }, 401);
    }
    let decoded: unknown;
    try {
      decoded = JSON.parse(payloadJson) as unknown;
    } catch {
      return context.json({ error: { code: "INVALID_EVENT" } }, 400);
    }
    const event = EventEnvelopeSchema.safeParse(decoded);
    if (!event.success) {
      return context.json({ error: { code: "INVALID_EVENT" } }, 400);
    }
    if (event.data.eventId !== eventId) {
      return context.json({ error: { code: "EVENT_ID_MISMATCH" } }, 400);
    }
    const payloadHash = createHash("sha256").update(payloadJson).digest("hex");
    const result = dependencies.store.accept(eventId, event.data.type, payloadHash, now);
    if (result === "conflict") {
      return context.json({ error: { code: "EVENT_ID_CONFLICT" } }, 409);
    }
    context.header("idempotent-replayed", result === "duplicate" ? "true" : "false");
    return context.body(null, 204);
  });
  app.notFound((context) => context.json({ error: { code: "NOT_FOUND" } }, 404));
  return app;
};
