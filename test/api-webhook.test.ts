import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Wallet } from "ethers";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createApiApp } from "../src/api/app.js";
import type { PPOpsConfig } from "../src/config.js";
import { PPOpsDatabase } from "../src/db/database.js";
import type { NormalizedSettlement } from "../src/domain.js";
import { WebhookDeliveryService, webhookSignature } from "../src/events/webhook.js";
import { IntentService } from "../src/intents/service.js";
import { ReconciliationService } from "../src/reconciliation/service.js";

const roots: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

const setup = () => {
  const root = mkdtempSync(join(tmpdir(), "ppops-api-test-"));
  roots.push(root);
  const database = new PPOpsDatabase(join(root, "ppops.sqlite"));
  const network: PPOpsConfig["network"] = {
    railgunNetworkName: "Ethereum_Sepolia",
    chainId: 11_155_111,
    tokenAddress: "0x00000000000000000000000000000000000000A1",
    tokenSymbol: "TESTUSD",
    tokenDecimals: 6,
    rpcUrls: ["https://rpc.example"],
    deploymentBlock: 1,
    finality: { mode: "confirmations", confirmations: 3 },
  };
  const intents = new IntentService(
    database,
    network,
    "0zk-test-receiver",
    Wallet.createRandom().privateKey,
  );
  return { root, database, network, intents };
};

describe("local authenticated API", () => {
  it("protects operational routes and creates a signed descriptor", async () => {
    const { database, intents } = setup();
    const app = createApiApp({
      database,
      intents,
      apiToken: "test-api-token",
      health: () => ({ railgunReady: false }),
    });
    const expiresAt = Math.floor(Date.now() / 1_000) + 3_600;
    const body = JSON.stringify({
      externalReference: "TOP_SECRET_INVOICE_4932",
      amountAtomic: "1000000",
      expiresAt,
    });

    const health = await app.request("/v1/health");
    expect(health.status).toBe(200);
    expect(health.headers.get("x-content-type-options")).toBe("nosniff");
    expect(
      (
        await app.request("/v1/intents", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
        })
      ).status,
    ).toBe(401);

    const created = await app.request("/v1/intents", {
      method: "POST",
      headers: {
        authorization: "Bearer test-api-token",
        "content-type": "application/json",
      },
      body,
    });
    expect(created.status).toBe(201);
    const payload = (await created.json()) as {
      externalReference: string;
      payment: { memo: string; descriptor: { merchantSigner: string } };
    };
    expect(payload.externalReference).toBe("TOP_SECRET_INVOICE_4932");
    expect(payload.payment.memo).toMatch(/^ppops:v1:0x[0-9a-f]{64}$/);
    expect(payload.payment.descriptor.merchantSigner).toBe(intents.merchantSigner);

    const missingWebhookRegistration = await app.request("/v1/webhooks", {
      method: "POST",
      headers: { authorization: "Bearer test-api-token" },
    });
    expect(missingWebhookRegistration.status).toBe(404);
    const oversized = await app.request("/v1/intents", {
      method: "POST",
      headers: {
        authorization: "Bearer test-api-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        externalReference: "x".repeat(70_000),
        amountAtomic: "1",
        expiresAt,
      }),
    });
    expect(oversized.status).toBe(413);
    database.close();
  });
});

describe("signed outbound webhook", () => {
  it("signs timestamp, event ID and exact payload without commercial metadata", async () => {
    const { database, network, intents } = setup();
    const intent = await intents.create(
      {
        externalReference: "SECRET_CUSTOMER_7338",
        amountAtomic: "10",
        expiresAt: 2_000,
      },
      1_000,
    );
    const transactionHash = `0x${"34".repeat(32)}`;
    const settlement: NormalizedSettlement = {
      uniqueSettlementId: `${network.chainId}:V2_PoseidonMerkle:${transactionHash}:0:1`,
      chainId: network.chainId,
      txidVersion: "V2_PoseidonMerkle",
      tree: 0,
      position: 1,
      transactionHash,
      tokenAddress: network.tokenAddress.toLowerCase(),
      amountAtomic: "10",
      blockNumber: 100,
      blockTimestamp: 1_500,
      balanceBucket: "Spendable",
      rawPPOIStatuses: { test_list: "Valid" },
      chainStatus: "FINALIZED",
      poiStatus: "SPENDABLE",
      reference: intent.reference,
    };
    new ReconciliationService(database).reconcile(settlement, 1_600);

    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fakeFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: url.toString(), ...(init ? { init } : {}) });
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    const key = "ab".repeat(32);
    const delivery = new WebhookDeliveryService(
      database,
      {
        url: "https://merchant.example/webhooks/ppops",
        timeoutMs: 1_000,
        maxAttempts: 3,
        baseRetryMs: 1_000,
        maxRetryMs: 10_000,
      },
      key,
      fakeFetch,
    );
    const result = await delivery.deliverPending(1_700);
    expect(result).toMatchObject({ attempted: 2, delivered: 2, failed: 0 });
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      const headers = new Headers(call.init?.headers);
      const payloadJson = String(call.init?.body);
      const timestamp = Number(headers.get("ppops-timestamp"));
      const eventId = headers.get("ppops-event-id") ?? "";
      expect(headers.get("ppops-signature")).toBe(
        webhookSignature(key, timestamp, eventId, payloadJson),
      );
      expect(call.init?.redirect).toBe("error");
      expect(payloadJson).not.toContain("SECRET_CUSTOMER_7338");
    }
    expect(database.countUndeliveredEvents()).toBe(0);
    database.close();
  });
});
