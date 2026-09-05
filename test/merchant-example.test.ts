import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MerchantStore } from "../src/examples/merchant.js";
import type { PaymentEvent } from "../src/client.js";

const fixtures: Array<{ store: MerchantStore; directory: string }> = [];
afterEach(async () => {
  for (const { store, directory } of fixtures.splice(0)) {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
const fixture = async () => {
  const directory = await mkdtemp(join(tmpdir(), "ppops-merchant-test-"));
  const store = new MerchantStore(join(directory, "orders.sqlite"));
  fixtures.push({ store, directory });
  store.reserve("order-0001");
  store.link("order-0001", "pi_" + "a".repeat(32), "/pay/fixture");
  const event: PaymentEvent = {
    schemaVersion: 1,
    eventId: "evt_" + "b".repeat(32),
    type: "payment.confirmed",
    occurredAt: 1000,
    intentId: "pi_" + "a".repeat(32),
    intentStatus: "PAID",
    expectedAmountAtomic: "1000000",
    receivedAmountAtomic: "1000000",
    overpaymentAmountAtomic: "0",
  };
  const accept = (value: PaymentEvent) =>
    store.accept(value, Buffer.from(JSON.stringify(value)));
  return { store, event, accept };
};

describe("durable merchant policies", () => {
  it("deduplicates delivery and confirmation without fulfilling twice", async () => {
    const { store, event, accept } = await fixture();
    expect(accept(event)).toBe("accepted");
    expect(accept(event)).toBe("duplicate");
    expect(() => accept({ ...event, receivedAmountAtomic: "2000000" })).toThrow(
      "conflict",
    );
    accept({ ...event, eventId: "evt_" + "c".repeat(32) });
    expect(store.order("order-0001")).toMatchObject({
      status: "fulfilled",
      fulfillment_count: 1,
    });
  });

  it("preserves late and reverted orders for review and displays expiry", async () => {
    const { store, event, accept } = await fixture();
    accept({
      ...event,
      type: "payment.expired",
      intentStatus: "EXPIRED",
      receivedAmountAtomic: "0",
    });
    expect(store.order("order-0001")?.status).toBe("expired");
    accept({
      ...event,
      eventId: "evt_" + "c".repeat(32),
      intentStatus: "PAID_LATE",
    });
    expect(store.order("order-0001")).toMatchObject({
      status: "needs_review",
      fulfillment_count: 0,
    });
    accept({
      ...event,
      eventId: "evt_" + "d".repeat(32),
      type: "payment.reverted",
      intentStatus: "OPEN",
      receivedAmountAtomic: "0",
    });
    expect(store.order("order-0001")).toMatchObject({
      status: "needs_review",
      fulfillment_count: 0,
    });
  });

  it("rolls back inconsistent events so a valid retry can be accepted", async () => {
    const { store, event, accept } = await fixture();
    expect(() => accept({ ...event, expectedAmountAtomic: "2000000" })).toThrow(
      "amount mismatch",
    );
    expect(() => accept({ ...event, receivedAmountAtomic: "1" })).toThrow(
      "Inconsistent confirmation",
    );
    expect(store.order("order-0001")?.fulfillment_count).toBe(0);
    expect(accept(event)).toBe("accepted");
    expect(store.order("order-0001")?.fulfillment_count).toBe(1);
  });
});
