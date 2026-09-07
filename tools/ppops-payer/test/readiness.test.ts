import { describe, expect, it } from "vitest";
import { payerReadiness } from "../src/readiness.js";
import type { PaymentRequest } from "../src/request.js";

// The classifier only accepts a request after descriptor verification at the CLI boundary.
const request = {
  status: "OPEN",
  expiresAt: 2000,
  amountAtomic: "20000000",
  receivedAmountAtomic: "0",
  pendingAmountAtomic: "0",
  reconciliationReady: true,
} as PaymentRequest;
const classify = (balances?: Record<string, string>, extra = {}) =>
  payerReadiness({
    request,
    feeBudgetAtomic: "70000",
    nowSeconds: 1000,
    balances,
    ...extra,
  });
describe("payer-local readiness", () => {
  it("requires enough Spendable funds for both amount and explicit fee budget", () => {
    expect(classify({ Spendable: "20000000" }).state).toBe(
      "INSUFFICIENT_PRIVATE_BALANCE",
    );
    expect(classify({ Spendable: "20070000" })).toMatchObject({
      state: "READY",
      requiredAmountAtomic: "20070000",
      feeBasis: "operator-budget-not-a-quote",
      paymentSubmitted: false,
    });
  });
  it("explains preparing funds without inventing an ETA", () => {
    expect(
      classify({ Spendable: "8000000", ShieldPending: "12070000" }),
    ).toMatchObject({
      state: "PRIVATE_BALANCE_PENDING",
      estimatedReadyAt: null,
      availableAmountAtomic: "8000000",
    });
    expect(classify({ MissingExternalPOI: "20070000" }).state).toBe(
      "PRIVATE_BALANCE_PENDING",
    );
    expect(
      classify({ Spendable: "8000000", ShieldPending: "1000000" }).state,
    ).toBe("INSUFFICIENT_PRIVATE_BALANCE");
  });
  it("does not count blocked or spent buckets as usable/preparing funds", () => {
    expect(
      classify({ ShieldBlocked: "99999999", Spent: "99999999" }).state,
    ).toBe("INSUFFICIENT_PRIVATE_BALANCE");
  });
  it("fails closed on missing, malformed, syncing and unavailable balance information", () => {
    expect(classify().state).toBe("RAIL_UNAVAILABLE");
    expect(classify({ Spendable: "-1" }).state).toBe("RAIL_UNAVAILABLE");
    expect(classify({ Spendable: "99999999" }, { syncing: true }).state).toBe(
      "SYNCING",
    );
    expect(
      classify({ Spendable: "99999999" }, { railAvailable: false }).state,
    ).toBe("RAIL_UNAVAILABLE");
    expect(
      classify(
        { Spendable: "99999999" },
        { request: { ...request, reconciliationReady: false } },
      ).state,
    ).toBe("RAIL_UNAVAILABLE");
  });
  it("cannot pay expired, pending, partially paid or completed requests", () => {
    expect(classify(undefined, { nowSeconds: 2000 }).state).toBe(
      "REQUEST_EXPIRED",
    );
    for (const patch of [
      { status: "PAID" },
      { status: "PARTIAL" },
      { paymentStage: "PAYMENT_REVERTED" },
      { paymentStage: "UNKNOWN_FUTURE_STAGE" },
      { pendingAmountAtomic: "1" },
      { receivedAmountAtomic: "1" },
    ]) {
      expect(
        classify(
          { Spendable: "99999999" },
          { request: { ...request, ...patch } },
        ).state,
      ).toBe("REQUEST_NOT_PAYABLE");
    }
  });
  it("uses exact arithmetic above the JavaScript integer range", () => {
    expect(
      classify(
        { Spendable: "9007199254740993123456" },
        { request: { ...request, amountAtomic: "9007199254740993123456" } },
      ),
    ).toMatchObject({
      state: "INSUFFICIENT_PRIVATE_BALANCE",
      shortfallAtomic: "70000",
    });
    expect(() => classify({}, { feeBudgetAtomic: "-1" })).toThrow();
  });
});
