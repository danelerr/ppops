import { describe, expect, it } from "vitest";
import { createDemo } from "../src/demo.js";
import type { NormalizedSettlement } from "../src/domain.js";
import { verifyCheckoutRequest } from "../src/api/checkout-model.js";

describe("PayIn public projection", () => {
  it("separates detected, finalized-pending, complete and reverted without leaking settlement metadata", async () => {
    const demo = await createDemo();
    try {
      const intent = await demo.intents.create({
        externalReference: "PRIVATE-ORDER-DO-NOT-EXPOSE",
        amountAtomic: "20000000",
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
      });
      const path = `/pay/${intent.id}/request.json`;
      const settlement: NormalizedSettlement = {
        uniqueSettlementId: "synthetic-payin",
        chainId: intent.chainId,
        txidVersion: "V2",
        tree: 0,
        position: 0,
        transactionHash: "0x" + "01".repeat(32),
        tokenAddress: intent.tokenAddress,
        amountAtomic: intent.expectedAmountAtomic,
        blockNumber: 1,
        blockTimestamp: intent.createdAt,
        balanceBucket: "MissingExternalPOI",
        rawPPOIStatuses: {},
        chainStatus: "OBSERVED",
        poiStatus: "PENDING",
        reference: intent.reference,
      };
      const read = async () => {
        const response = await demo.app.request(path);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(response.headers.get("referrer-policy")).toBe("no-referrer");
        const body = await response.text();
        expect(body).not.toContain(intent.externalReference);
        expect(body).not.toContain("transactionHash");
        expect(body).not.toContain("rawPPOIStatuses");
        return verifyCheckoutRequest(JSON.parse(body));
      };
      expect((await read()).paymentStage).toBe("AWAITING_PAYMENT");
      demo.reconciliation.reconcile(settlement);
      expect(await read()).toMatchObject({
        paymentStage: "PAYMENT_DETECTED",
        status: "OPEN",
        receivedAmountAtomic: "0",
      });
      demo.reconciliation.reconcile({
        ...settlement,
        chainStatus: "FINALIZED",
      });
      expect(await read()).toMatchObject({
        paymentStage: "PRIVACY_CHECKS_PENDING",
        receivedAmountAtomic: "0",
      });
      demo.reconciliation.reconcile({
        ...settlement,
        chainStatus: "FINALIZED",
        poiStatus: "SPENDABLE",
        balanceBucket: "Spendable",
      });
      expect(await read()).toMatchObject({
        paymentStage: "PAYMENT_COMPLETE",
        status: "PAID",
        receivedAmountAtomic: "20000000",
      });
      demo.reconciliation.reconcile({ ...settlement, chainStatus: "REVERTED" });
      expect(await read()).toMatchObject({
        paymentStage: "PAYMENT_REVERTED",
        status: "OPEN",
        receivedAmountAtomic: "0",
      });
      for (const url of [`/pay/${intent.id}`, "/pay/unknown", "/payer-guide"]) {
        const response = await demo.app.request(url);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(response.headers.get("referrer-policy")).toBe("no-referrer");
        expect(response.headers.get("content-security-policy")).not.toContain(
          "unsafe-inline",
        );
      }
    } finally {
      await demo.close();
    }
  });
});
