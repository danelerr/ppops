import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { webhookSignature } from "../src/events/webhook.js";
import {
  createPilotWebhookReceiverApp,
  PilotWebhookStore,
} from "../src/pilot/webhook-receiver.js";

const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

describe("pilot webhook receiver", () => {
  it("verifies exact bodies and persists event-ID deduplication without payloads", async () => {
    const root = mkdtempSync(join(tmpdir(), "ppops-pilot-receiver-"));
    roots.push(root);
    const stateFile = join(root, "events.sqlite");
    const key = "cd".repeat(32);
    const keyId = "pilot-key-1";
    const timestamp = 2_000;
    const eventId = `evt_${"12".repeat(16)}`;
    const payload = JSON.stringify({
      schemaVersion: 1,
      eventId,
      type: "payment.confirmed",
      occurredAt: 2_000,
      intentId: "pi_pilot",
      settlementId: "SECRET_CUSTOMER_MUST_NOT_PERSIST",
      intentStatus: "PAID",
      receivedAmountAtomic: "100000",
      expectedAmountAtomic: "100000",
      overpaymentAmountAtomic: "0",
    });
    const store = new PilotWebhookStore(stateFile);
    const app = createPilotWebhookReceiverApp({
      hmacKeyHex: key,
      keyId,
      store,
      now: () => 2_030,
    });
    const request = (body: string, signature = webhookSignature(key, timestamp, eventId, body, keyId)) =>
      app.request("/webhooks/ppops", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "ppops-timestamp": timestamp.toString(),
          "ppops-event-id": eventId,
          "ppops-key-id": keyId,
          "ppops-signature": signature,
        },
        body,
      });

    const accepted = await request(payload);
    expect(accepted.status).toBe(204);
    expect(accepted.headers.get("idempotent-replayed")).toBe("false");
    const replay = await request(payload);
    expect(replay.status).toBe(204);
    expect(replay.headers.get("idempotent-replayed")).toBe("true");
    expect(store.count()).toBe(1);
    expect(store.countsByType()).toEqual({ "payment.confirmed": 1 });
    const stats = await app.request("/stats");
    expect(await stats.json()).toEqual({
      receivedEventCount: 1,
      receivedEventsByType: { "payment.confirmed": 1 },
      storesPayloads: false,
    });

    const altered = `${payload} `;
    expect((await request(altered)).status).toBe(409);
    expect((await request(payload, `v1=${"00".repeat(32)}`)).status).toBe(401);
    const mismatched = payload.replace(eventId, `evt_${"99".repeat(16)}`);
    expect((await request(mismatched)).status).toBe(400);
    expect((await request("{")).status).toBe(400);
    store.close();
    expect(readFileSync(stateFile).includes(Buffer.from("SECRET_CUSTOMER"))).toBe(false);

    const restarted = new PilotWebhookStore(stateFile);
    expect(restarted.count()).toBe(1);
    restarted.close();
  });

  it("rejects stale signatures, wrong key IDs, media types and oversized bodies", async () => {
    const root = mkdtempSync(join(tmpdir(), "ppops-pilot-receiver-"));
    roots.push(root);
    const store = new PilotWebhookStore(join(root, "events.sqlite"));
    const key = "ef".repeat(32);
    const eventId = `evt_${"34".repeat(16)}`;
    const app = createPilotWebhookReceiverApp({
      hmacKeyHex: key,
      keyId: "v1",
      store,
      now: () => 2_000,
    });
    const payload = JSON.stringify({
      schemaVersion: 1,
      eventId,
      type: "payment.confirmed",
      occurredAt: 1_000,
      intentId: "pi_pilot",
      intentStatus: "PAID",
      receivedAmountAtomic: "1",
      expectedAmountAtomic: "1",
      overpaymentAmountAtomic: "0",
    });
    const headers = {
      "content-type": "application/json",
      "ppops-timestamp": "1000",
      "ppops-event-id": eventId,
      "ppops-key-id": "v1",
      "ppops-signature": webhookSignature(key, 1_000, eventId, payload),
    };
    expect(
      (await app.request("/webhooks/ppops", { method: "POST", headers, body: payload }))
        .status,
    ).toBe(401);
    expect(
      (
        await app.request("/webhooks/ppops", {
          method: "POST",
          headers: { ...headers, "content-type": "text/plain" },
          body: payload,
        })
      ).status,
    ).toBe(415);
    const oversized = "x".repeat(64 * 1024 + 1);
    expect(
      (
        await app.request("/webhooks/ppops", {
          method: "POST",
          headers: {
            ...headers,
            "ppops-timestamp": "2000",
            "ppops-signature": webhookSignature(key, 2_000, eventId, oversized),
          },
          body: oversized,
        })
      ).status,
    ).toBe(413);
    store.close();
  });
});
