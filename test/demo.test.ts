import { afterEach, describe, expect, it } from "vitest";
import { createDemo, startDemo } from "../src/demo.js";
import { usdcAtomic } from "../src/client.js";

const demos: Array<Awaited<ReturnType<typeof createDemo>>> = [];
afterEach(async () => {
  await Promise.all(demos.splice(0).map((demo) => demo.close()));
});

describe("first successful integration", () => {
  it("creates an order, renders checkout, verifies payment and fulfills once after retries", async () => {
    const demo = await createDemo();
    demos.push(demo);
    const { app } = demo;
    expect((await app.request("/shop")).status).toBe(200);
    const create = () =>
      app.request("/shop/orders/demo-order-0001", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
    const response = await create();
    expect(response.status).toBe(201);
    const order = await response.json();
    expect((await (await create()).json()).intent_id).toBe(order.intent_id);
    expect((await app.request(order.checkoutUrl)).status).toBe(200);
    const request = await (
      await app.request(order.checkoutUrl + "/request.json")
    ).json();
    expect(request.simulated).toBe(true);
    expect(request.recipient).toBe("DEMO-NOT-A-PAYMENT-ADDRESS");
    const pay = () =>
      app.request(`/demo/${order.intent_id}/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
    expect((await pay()).status).toBe(200);
    expect((await pay()).status).toBe(200);
    const finalOrder = await (
      await app.request("/shop/orders/demo-order-0001")
    ).json();
    expect(finalOrder).toMatchObject({
      status: "fulfilled",
      fulfillment_count: 1,
    });
    expect(
      demo.database
        .listEvents()
        .filter((event) => event.type === "payment.confirmed"),
    ).toHaveLength(1);
    expect(
      demo.database
        .listOutboxStatus()
        .every((event) => event.deliveredAt !== undefined),
    ).toBe(true);
    expect(
      (
        await app.request(`/demo/${order.intent_id}/confirm`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "https://other.example",
          },
          body: "{}",
        })
      ).status,
    ).toBe(403);
  });

  it("listens on loopback and shuts down its HTTP server", async () => {
    const server = await startDemo(0);
    try {
      expect((await fetch(`http://127.0.0.1:${server.port}/shop`)).status).toBe(
        200,
      );
    } finally {
      await server.stop();
    }
    await expect(
      fetch(`http://127.0.0.1:${server.port}/shop`),
    ).rejects.toThrow();
  });

  it("converts human USDC without rounding or floating point", () => {
    expect(usdcAtomic("1.25")).toBe("1250000");
    expect(usdcAtomic("0.000001")).toBe("1");
    expect(usdcAtomic("9007199254740993.01")).toBe("9007199254740993010000");
    for (const input of ["0", "1.0000001", "1e6", "-1", "NaN"])
      expect(() => usdcAtomic(input)).toThrow();
  });
});
