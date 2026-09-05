import { createHmac, randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PPOpsClient,
  PPOpsApiError,
  verifyPaymentWebhook,
} from "../src/client.js";
import { createDemo } from "../src/demo.js";
import {
  CheckoutHttpSchema,
  EventSchema,
  IntentHttpSchema,
  IntentProjectionHttpSchema,
} from "../src/api/contracts.js";
import { openApiDocument } from "../src/api/openapi.js";

afterEach(() => vi.restoreAllMocks());

describe("merchant HTTP contract", () => {
  it("matches the published schemas through the complete demo lifecycle", async () => {
    const demo = await createDemo();
    try {
      const order = await (
        await demo.app.request("/shop/orders/schema-order-0001", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        })
      ).json();
      const request = CheckoutHttpSchema.parse(
        await (
          await demo.app.request(order.checkoutUrl + "/request.json")
        ).json(),
      );
      expect(request.amountAtomic).toBe("1000000");
      expect(
        IntentHttpSchema.parse(await demo.client.getIntent(order.intent_id))
          .status,
      ).toBe("OPEN");
      expect(
        IntentProjectionHttpSchema.parse(
          await demo.client.request(`/v1/intents/${order.intent_id}/status`),
        ).status,
      ).toBe("OPEN");
      await demo.app.request(`/demo/${order.intent_id}/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      for (const event of demo.database.listEvents())
        expect(() => EventSchema.parse(event)).not.toThrow();
      expect(
        openApiDocument.paths["/v1/intents"].post.responses["201"],
      ).toBeDefined();
      expect(openApiDocument.components.schemas.CreateIntent).toBeDefined();
    } finally {
      await demo.close();
    }
  });

  it("preserves the caller's idempotency key/body, bounds requests and reports HTTP errors", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(Response.json({ id: "fixture" }, { status: 201 }));
    const client = new PPOpsClient({
      baseUrl: "http://127.0.0.1:8787",
      apiToken: "test-token",
      fetch,
    });
    const body = {
      externalReference: "order",
      amountAtomic: "1000000",
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    };
    await client.createIntent(body, "order-test-0001");
    expect(fetch.mock.calls[0]?.[1].body).toBe(JSON.stringify(body));
    expect(fetch.mock.calls[0]?.[1].headers.get("idempotency-key")).toBe(
      "order-test-0001",
    );
    expect(fetch.mock.calls[0]?.[1].redirect).toBe("error");
    fetch.mockResolvedValue(
      Response.json(
        { error: { code: "IDEMPOTENCY_CONFLICT" } },
        { status: 409 },
      ),
    );
    await expect(
      client.createIntent(body, "order-test-0001"),
    ).rejects.toBeInstanceOf(PPOpsApiError);
    fetch.mockResolvedValue(
      Response.json({ items: [], limit: 100, offset: 0 }),
    );
    await client.listIntents();
    expect(fetch).toHaveBeenLastCalledWith(
      "http://127.0.0.1:8787/v1/intents?limit=100&offset=0",
      expect.anything(),
    );
    fetch.mockResolvedValue(Response.json({ id: "a" }));
    await client.getIntent("a");
    await expect(
      client.request("https://external.example/v1/intents"),
    ).rejects.toThrow();
    expect(
      () =>
        new PPOpsClient({
          baseUrl: "http://external.example",
          apiToken: "test",
        }),
    ).toThrow();
    expect(
      () =>
        new PPOpsClient({ baseUrl: "https://external.example", apiToken: "" }),
    ).toThrow();
    expect(
      () =>
        new PPOpsClient({
          baseUrl: "https://external.example/private",
          apiToken: "test",
        }),
    ).toThrow();
  });
});

describe("webhook consumer verification", () => {
  const key = randomBytes(32).toString("hex");
  const event = {
    schemaVersion: 1,
    eventId: "evt_" + "a".repeat(32),
    type: "payment.confirmed",
    occurredAt: 1000,
    intentId: "pi_" + "b".repeat(32),
    intentStatus: "PAID",
    expectedAmountAtomic: "1000000",
    receivedAmountAtomic: "1000000",
    overpaymentAmountAtomic: "0",
  };
  const signed = (
    body: unknown = event,
    timestamp = 1000,
    id = event.eventId,
  ) => {
    const rawBody = Buffer.from(JSON.stringify(body, null, 2));
    const signature =
      "v1=" +
      createHmac("sha256", Buffer.from(key, "hex"))
        .update(`${timestamp}.v1.${id}.`)
        .update(rawBody)
        .digest("hex");
    return {
      rawBody,
      headers: new Headers({
        "ppops-timestamp": String(timestamp),
        "ppops-key-id": "v1",
        "ppops-event-id": id,
        "ppops-signature": signature,
      }),
      keys: { v1: key },
      nowSeconds: 1000,
    };
  };
  it("verifies the original bytes and accepts known keys during rotation", () => {
    expect(verifyPaymentWebhook(signed())).toEqual(event);
    expect(
      verifyPaymentWebhook({
        ...signed(),
        keys: { v1: key, v2: randomBytes(32).toString("hex") },
      }),
    ).toEqual(event);
  });
  it("rejects stale, reformatted, wrong-identity and unknown-schema events", () => {
    expect(() => verifyPaymentWebhook(signed(event, 1))).toThrow();
    expect(() =>
      verifyPaymentWebhook({
        ...signed(),
        rawBody: Buffer.from(JSON.stringify(event)),
      }),
    ).toThrow();
    expect(() =>
      verifyPaymentWebhook(
        signed({ ...event, eventId: "evt_" + "c".repeat(32) }),
      ),
    ).toThrow();
    expect(() =>
      verifyPaymentWebhook(signed({ ...event, schemaVersion: 2 })),
    ).toThrow();
    expect(() => verifyPaymentWebhook({ ...signed(), keys: {} })).toThrow();
    expect(() =>
      verifyPaymentWebhook({ ...signed(), rawBody: Buffer.alloc(65537) }),
    ).toThrow();
  });
});
