import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Wallet } from "ethers";
import { afterEach, describe, expect, it } from "vitest";

import { createApiApp } from "../src/api/app.js";
import {
  ARBITRUM_MAINNET_CHAIN_ID,
  ARBITRUM_NATIVE_USDC,
  type PPOpsConfig,
} from "../src/config.js";
import { PPOpsDatabase } from "../src/db/database.js";
import type { NormalizedSettlement } from "../src/domain.js";
import { WebhookDeliveryService } from "../src/events/webhook.js";
import { IntentService } from "../src/intents/service.js";
import {
  captureMainnetGateSnapshot,
  replayConfirmedWebhookForGate,
  signMainnetGateReport,
  verifySignedMainnetGateReport,
  verifyMainnetGateSnapshots,
  type MainnetGatePhase,
} from "../src/pilot/mainnet-gate.js";
import {
  createPilotWebhookReceiverApp,
  PilotWebhookStore,
} from "../src/pilot/webhook-receiver.js";
import { ReconciliationService } from "../src/reconciliation/service.js";

const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

describe("Arbitrum USDC mainnet evidence gate", () => {
  it("authenticates redacted snapshots and proves stable restart/restore state", async () => {
    const root = mkdtempSync(join(tmpdir(), "ppops-mainnet-gate-"));
    roots.push(root);
    const database = new PPOpsDatabase(join(root, "ppops.sqlite"));
    const network: PPOpsConfig["network"] = {
      railgunNetworkName: "Arbitrum",
      chainId: ARBITRUM_MAINNET_CHAIN_ID,
      tokenAddress: ARBITRUM_NATIVE_USDC,
      tokenSymbol: "USDC",
      tokenDecimals: 6,
      rpcUrls: ["https://rpc-a.example", "https://rpc-b.example"],
      deploymentBlock: 56_109_834,
      finality: { mode: "finalized" },
    };
    const merchant = Wallet.createRandom();
    const intents = new IntentService(
      database,
      network,
      `0zk${"a".repeat(64)}`,
      merchant.privateKey,
    );
    const currentTime = Math.floor(Date.now() / 1_000);
    const intent = await intents.create(
      {
        externalReference: "SECRET_MAINNET_ORDER_0001",
        amountAtomic: "100000",
        expiresAt: currentTime + 3_600,
      },
      currentTime,
    );
    const transactionHash = `0x${"77".repeat(32)}`;
    const settlement: NormalizedSettlement = {
      uniqueSettlementId:
        `${ARBITRUM_MAINNET_CHAIN_ID}:V2_PoseidonMerkle:${transactionHash}:7:11`,
      chainId: ARBITRUM_MAINNET_CHAIN_ID,
      txidVersion: "V2_PoseidonMerkle",
      tree: 7,
      position: 11,
      transactionHash,
      tokenAddress: ARBITRUM_NATIVE_USDC,
      amountAtomic: "100000",
      blockNumber: 500_000_000,
      blockTimestamp: currentTime + 30,
      balanceBucket: "Spendable",
      rawPPOIStatuses: { production_list: "Valid" },
      chainStatus: "FINALIZED",
      poiStatus: "SPENDABLE",
      reference: intent.reference,
    };
    new ReconciliationService(database).reconcile(settlement, currentTime + 60);

    const apiToken = "test-mainnet-api-token-with-at-least-forty-three-characters";
    const webhookKey = "ab".repeat(32);
    const receiverStore = new PilotWebhookStore(join(root, "receiver.sqlite"));
    const receiver = createPilotWebhookReceiverApp({
      hmacKeyHex: webhookKey,
      keyId: "v1",
      store: receiverStore,
    });

    const health = () => ({
      railgunReady: true,
      startedAt: currentTime,
      scanInProgress: false,
      consecutiveFailures: 0,
      scansSucceeded: 2,
      scansFailed: 0,
      lastScanAt: currentTime + 60,
    });
    const apiFor = (instanceId: string) =>
      createApiApp({
        database,
        intents,
        apiToken,
        health,
        runtimeInfo: {
          instanceId,
          chainId: ARBITRUM_MAINNET_CHAIN_ID,
          tokenAddress: ARBITRUM_NATIVE_USDC,
          tokenSymbol: "USDC",
          tokenDecimals: 6,
          finalityMode: "finalized",
          rpcProviderCount: 2,
          ppoiConfiguredNodeCount: 1,
        },
      });
    let primaryApi = apiFor("2df6e018-13d8-4a63-a824-cd6e2ca11356");
    const restoredApi = apiFor("54e06e51-bd67-4dc5-b3a3-f58ed67868c9");
    const dispatch = (async (
      input: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      const target = `${url.pathname}${url.search}`;
      if (url.origin === "http://127.0.0.1:8787") {
        return primaryApi.request(target, init);
      }
      if (url.origin === "http://127.0.0.1:8788") {
        return restoredApi.request(target, init);
      }
      if (url.origin === "http://127.0.0.1:8790") {
        return receiver.request(target, init);
      }
      throw new Error(`Unexpected test origin: ${url.origin}`);
    }) as typeof fetch;

    const delivery = new WebhookDeliveryService(
      database,
      {
        url: "http://127.0.0.1:8790/webhooks/ppops",
        keyId: "v1",
        timeoutMs: 1_000,
        maxAttempts: 3,
        baseRetryMs: 1_000,
        maxRetryMs: 10_000,
      },
      webhookKey,
      dispatch,
    );
    expect(await delivery.deliverPending(currentTime + 90)).toMatchObject({
      attempted: 2,
      delivered: 2,
    });
    const preflight = {
      rpcProviderCount: 2,
      ppoiConfiguredNodeCount: 1,
      ppoiHealthyNodeCount: 1,
      latestBlock: 500_010_000,
      finalizedBlock: 500_000_100,
    };
    const blockHash = `0x${"88".repeat(32)}`;
    const rpcQuorum = {
      getTransactionReceipt: async (hash: string) => ({
        hash,
        blockNumber: settlement.blockNumber,
        blockHash,
        status: 1,
      }),
      getBlock: async (blockNumber: number) => ({
        number: blockNumber,
        hash: blockHash,
      }),
    };
    await expect(
      captureMainnetGateSnapshot({
        phase: "before",
        baseUrl: "http://127.0.0.1:8787",
        receiverStatsUrl: "http://127.0.0.1:8790/stats",
        apiToken,
        intentId: intent.id,
        expectedSigner: merchant.address,
        preflight,
        rpcQuorum,
        now: currentTime + 95,
        fetchImplementation: dispatch,
      }),
    ).rejects.toThrow(/deduplication/);
    const dispatchWithOnlyOtherEventDuplicated = (async (
      input: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.origin === "http://127.0.0.1:8790" && url.pathname === "/stats") {
        return Response.json({
          receivedEventCount: 2,
          deliveryAttemptCount: 3,
          duplicateDeliveryCount: 1,
          receivedEventsByType: {
            "settlement.observed": 1,
            "payment.confirmed": 1,
          },
          deliveryAttemptsByType: {
            "settlement.observed": 2,
            "payment.confirmed": 1,
          },
          duplicateDeliveriesByType: {
            "settlement.observed": 1,
            "payment.confirmed": 0,
          },
          storesPayloads: false,
        });
      }
      return dispatch(input, init);
    }) as typeof fetch;
    await expect(
      captureMainnetGateSnapshot({
        phase: "before",
        baseUrl: "http://127.0.0.1:8787",
        receiverStatsUrl: "http://127.0.0.1:8790/stats",
        apiToken,
        intentId: intent.id,
        expectedSigner: merchant.address,
        preflight,
        rpcQuorum,
        now: currentTime + 96,
        fetchImplementation: dispatchWithOnlyOtherEventDuplicated,
      }),
    ).rejects.toThrow(/deduplication/);
    await expect(
      replayConfirmedWebhookForGate({
        baseUrl: "http://127.0.0.1:8787",
        webhookUrl: "http://127.0.0.1:8790/webhooks/ppops",
        apiToken,
        webhookHmacKeyHex: webhookKey,
        keyId: "v1",
        intentId: intent.id,
        now: currentTime + 100,
        fetchImplementation: dispatch,
      }),
    ).resolves.toEqual({ ok: true, idempotentReplay: true });

    const snapshot = (phase: MainnetGatePhase, baseUrl: string, now: number) =>
      captureMainnetGateSnapshot({
        phase,
        baseUrl,
        receiverStatsUrl: "http://127.0.0.1:8790/stats",
        apiToken,
        intentId: intent.id,
        expectedSigner: merchant.address,
        preflight,
        rpcQuorum,
        now,
        fetchImplementation: dispatch,
      });

    const before = await snapshot("before", "http://127.0.0.1:8787", currentTime + 110);
    await expect(
      captureMainnetGateSnapshot({
        phase: "before",
        baseUrl: "http://127.0.0.1:8787",
        receiverStatsUrl: "http://127.0.0.1:8790/stats",
        apiToken,
        intentId: intent.id,
        expectedSigner: merchant.address,
        preflight,
        rpcQuorum: {
          ...rpcQuorum,
          getBlock: async (blockNumber: number) => ({
            number: blockNumber,
            hash: `0x${"99".repeat(32)}`,
          }),
        },
        now: currentTime + 111,
        fetchImplementation: dispatch,
      }),
    ).rejects.toThrow(/block hash/);
    await expect(
      captureMainnetGateSnapshot({
        phase: "before",
        baseUrl: "http://not-loopback.example",
        receiverStatsUrl: "http://127.0.0.1:8790/stats",
        apiToken,
        intentId: intent.id,
        expectedSigner: merchant.address,
        preflight,
        rpcQuorum,
        fetchImplementation: dispatch,
      }),
    ).rejects.toThrow(/HTTPS/);
    await expect(
      captureMainnetGateSnapshot({
        phase: "before",
        baseUrl: "http://127.0.0.1:8787",
        receiverStatsUrl: "http://127.0.0.1:8790/stats",
        apiToken,
        intentId: intent.id,
        expectedSigner: Wallet.createRandom().address,
        preflight,
        rpcQuorum,
        fetchImplementation: dispatch,
      }),
    ).rejects.toThrow(/trusted merchant signer/);
    const sameInstanceRestart = await snapshot(
      "restart",
      "http://127.0.0.1:8787",
      currentTime + 115,
    );
    primaryApi = apiFor("f6260d32-9968-42cd-97d0-5f11c272fd46");
    const restart = await snapshot(
      "restart",
      "http://127.0.0.1:8787",
      currentTime + 120,
    );
    const restore = await snapshot(
      "restore",
      "http://127.0.0.1:8788",
      currentTime + 130,
    );
    const report = verifyMainnetGateSnapshots({
      before,
      restart,
      restore,
      apiToken,
      now: currentTime + 140,
    });
    expect(report.result).toBe("PASS");
    expect(new Set(Object.values(report.checks))).toEqual(new Set(["PASS"]));
    expect(() =>
      verifyMainnetGateSnapshots({
        before,
        restart,
        restore,
        apiToken,
        now: currentTime + 129,
      }),
    ).toThrow(/predates/);
    const signedReport = await signMainnetGateReport(report, merchant.privateKey);
    expect(
      verifySignedMainnetGateReport(signedReport, merchant.address).reportSignature
        .signer,
    ).toBe(merchant.address);
    const alteredReport = structuredClone(signedReport);
    alteredReport.evidence.restoreCapturedAt += 1;
    expect(() =>
      verifySignedMainnetGateReport(alteredReport, merchant.address),
    ).toThrow();
    const publicEvidence = JSON.stringify({
      before,
      restart,
      restore,
      report: signedReport,
    });
    expect(publicEvidence).not.toContain("SECRET_MAINNET_ORDER_0001");
    expect(publicEvidence).not.toContain(intent.id);
    expect(publicEvidence).not.toContain(intent.reference);
    expect(publicEvidence).not.toContain(transactionHash);

    const tampered = structuredClone(restart);
    tampered.state.receivedAmountAtomic = "100001";
    expect(() =>
      verifyMainnetGateSnapshots({ before, restart: tampered, restore, apiToken }),
    ).toThrow(/attestation/);

    const injectedRoot = structuredClone(restart) as unknown as Record<string, unknown>;
    injectedRoot.externalReference = "SECRET_MUST_BE_REJECTED";
    expect(() =>
      verifyMainnetGateSnapshots({ before, restart: injectedRoot, restore, apiToken }),
    ).toThrow();
    const injectedNested = structuredClone(restart) as unknown as {
      state: Record<string, unknown>;
    };
    injectedNested.state.transactionHash = transactionHash;
    expect(() =>
      verifyMainnetGateSnapshots({ before, restart: injectedNested, restore, apiToken }),
    ).toThrow();

    expect(() =>
      verifyMainnetGateSnapshots({
        before,
        restart: sameInstanceRestart,
        restore,
        apiToken,
      }),
    ).toThrow(/distinct daemon instance/);

    receiverStore.close();
    database.close();
  });
});
