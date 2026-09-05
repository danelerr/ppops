import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  PPOpsClient,
  verifyPaymentWebhook,
  type PaymentEvent,
} from "../client.js";
import { SHOP_JS } from "./shop.js";

type Order = {
  id: string;
  amount_atomic: string;
  expires_at: number;
  intent_id: string | null;
  checkout_path: string | null;
  status: string;
  fulfillment_count: number;
};

/** Example business database: event receipt and fulfillment commit together. */
export class MerchantStore {
  readonly database: Database.Database;
  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.database = new Database(path);
    if (process.platform !== "win32") chmodSync(path, 0o600);
    this.database.pragma("journal_mode = WAL");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, amount_atomic TEXT NOT NULL,
        expires_at INTEGER NOT NULL, intent_id TEXT UNIQUE, checkout_path TEXT,
        status TEXT NOT NULL DEFAULT 'awaiting_payment', fulfillment_count INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS webhook_receipts (event_id TEXT PRIMARY KEY, payload_hash TEXT NOT NULL);
    `);
  }
  order(id: string): Order | undefined {
    return this.database
      .prepare("SELECT * FROM orders WHERE id = ?")
      .get(id) as Order | undefined;
  }
  reserve(id: string): Order {
    // The server owns the price and persists expiry before the first HTTP attempt.
    this.database
      .prepare(
        "INSERT OR IGNORE INTO orders (id, amount_atomic, expires_at) VALUES (?, '1000000', ?)",
      )
      .run(id, Math.floor(Date.now() / 1000) + 7200);
    return this.order(id)!;
  }
  link(id: string, intentId: string, checkoutPath: string): void {
    this.database
      .prepare(
        "UPDATE orders SET intent_id = ?, checkout_path = ? WHERE id = ?",
      )
      .run(intentId, checkoutPath, id);
  }
  accept(event: PaymentEvent, raw: Uint8Array): "accepted" | "duplicate" {
    return this.database.transaction(() => {
      const hash = createHash("sha256").update(raw).digest("hex");
      const previous = this.database
        .prepare("SELECT payload_hash FROM webhook_receipts WHERE event_id = ?")
        .get(event.eventId) as { payload_hash: string } | undefined;
      if (previous) {
        if (previous.payload_hash !== hash)
          throw new Error("Event ID payload conflict");
        return "duplicate" as const;
      }
      const order = this.database
        .prepare("SELECT * FROM orders WHERE intent_id = ?")
        .get(event.intentId) as Order | undefined;
      if (!order || order.amount_atomic !== event.expectedAmountAtomic)
        throw new Error("Unknown order or amount mismatch");
      this.database
        .prepare("INSERT INTO webhook_receipts VALUES (?, ?)")
        .run(event.eventId, hash);
      if (event.type === "payment.confirmed") {
        if (
          !["PAID", "PAID_LATE"].includes(event.intentStatus) ||
          BigInt(event.receivedAmountAtomic) < BigInt(order.amount_atomic)
        )
          throw new Error("Inconsistent confirmation");
        if (event.intentStatus === "PAID" && order.fulfillment_count === 0) {
          this.database
            .prepare(
              "UPDATE orders SET status = 'fulfilled', fulfillment_count = 1 WHERE id = ?",
            )
            .run(order.id);
        } else if (
          event.intentStatus === "PAID_LATE" &&
          order.fulfillment_count === 0
        ) {
          this.database
            .prepare("UPDATE orders SET status = 'needs_review' WHERE id = ?")
            .run(order.id);
        }
      } else if (event.type === "payment.reverted") {
        this.database
          .prepare("UPDATE orders SET status = 'needs_review' WHERE id = ?")
          .run(order.id);
      } else if (
        event.type === "payment.expired" &&
        order.status === "awaiting_payment"
      ) {
        this.database
          .prepare("UPDATE orders SET status = 'expired' WHERE id = ?")
          .run(order.id);
      }
      return "accepted" as const;
    })();
  }
  close(): void {
    this.database.close();
  }
}

export const createMerchantExample = (args: {
  client: PPOpsClient;
  store: MerchantStore;
  webhookKeys: Readonly<Record<string, string>>;
  checkoutOrigin: string;
  demo?: boolean;
}) => {
  const app = new Hono();
  app.use("*", secureHeaders());
  app.use("*", bodyLimit({ maxSize: 65536 }));
  app.use("*", async (context, next) => {
    context.header("cache-control", "no-store");
    if (
      context.req.method === "POST" &&
      context.req.header("content-type")?.split(";", 1)[0] !==
        "application/json"
    )
      return context.json({ error: "Use application/json." }, 415);
    if (
      context.req.method === "POST" &&
      context.req.header("origin") &&
      context.req.header("origin") !== new URL(context.req.url).origin
    )
      return context.json(
        { error: "Cross-origin requests are not accepted." },
        403,
      );
    await next();
  });
  app.get("/", (context) =>
    context.html(
      `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PPOps · Example shop</title><link rel="stylesheet" href="/assets/pay.css"><main><p class="eyebrow">${args.demo ? "SIMULATION · NO FUNDS MOVE" : "MERCHANT INTEGRATION EXAMPLE"}</p><h1>One order.<br>One private payment.</h1><p>Try the complete flow: create an order, open its payment request and receive a verified webhook.</p><p class="amount">1.00 <span>USDC</span></p><button id="create">Create order</button> <button id="new-order" hidden>New order</button><p id="message" role="status" aria-live="polite"></p><a id="checkout" hidden>Open payment request</a><pre id="order" aria-label="Order and fulfillment state"></pre><p>This example fulfills on-time payments once. Late or reverted payments go to manual review.</p></main><script src="/shop/app.js" defer></script></html>`,
    ),
  );
  app.get("/app.js", (context) =>
    context.text(SHOP_JS, 200, { "content-type": "text/javascript" }),
  );
  app.post("/orders/:id", async (context) => {
    const id = context.req.param("id");
    if (!/^[a-zA-Z0-9_-]{8,64}$/.test(id))
      return context.json(
        {
          error:
            "Use a stable order ID with 8–64 letters, digits, underscores or hyphens.",
        },
        400,
      );
    const order = args.store.reserve(id);
    try {
      const intent = await args.client.createIntent(
        {
          externalReference: id,
          amountAtomic: order.amount_atomic,
          expiresAt: order.expires_at,
        },
        `order:${id}`,
      );
      args.store.link(id, intent.id, intent.checkoutPath);
      return context.json(
        {
          ...args.store.order(id),
          checkoutUrl: args.checkoutOrigin + intent.checkoutPath,
        },
        201,
      );
    } catch {
      return context.json(
        {
          error:
            "PPOps is unavailable. Retry this same order ID and keep its saved amount and expiry.",
        },
        502,
      );
    }
  });
  app.get("/orders/:id", (context) => {
    const order = args.store.order(context.req.param("id"));
    return order
      ? context.json({
          ...order,
          checkoutUrl: order.checkout_path
            ? args.checkoutOrigin + order.checkout_path
            : null,
        })
      : context.json({ error: "Order not found." }, 404);
  });
  app.post("/webhooks/ppops", async (context) => {
    let event: PaymentEvent;
    const raw = new Uint8Array(await context.req.arrayBuffer());
    try {
      event = verifyPaymentWebhook({
        rawBody: raw,
        headers: context.req.raw.headers,
        keys: args.webhookKeys,
      });
    } catch {
      return context.json({ error: "Webhook authentication failed." }, 400);
    }
    try {
      return context.json({ status: args.store.accept(event, raw) });
    } catch {
      return context.json(
        {
          error:
            "Order mapping is not ready or event conflicts with stored state.",
        },
        409,
      );
    }
  });
  return app;
};
