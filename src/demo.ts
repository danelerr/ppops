import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { Wallet } from "ethers";
import { createApiApp } from "./api/app.js";
import { PPOpsClient } from "./client.js";
import { PPOpsDatabase } from "./db/database.js";
import { IntentService } from "./intents/service.js";
import { ReconciliationService } from "./reconciliation/service.js";
import { WebhookDeliveryService } from "./events/webhook.js";
import { createMerchantExample, MerchantStore } from "./examples/merchant.js";
import type { PPOpsConfig } from "./config.js";

/** Isolated simulation: no config files, RAILGUN engine, RPCs or wallet secrets. */
export const createDemo = async () => {
  const directory = await mkdtemp(join(tmpdir(), "ppops-demo-"));
  const database = new PPOpsDatabase(join(directory, "daemon.sqlite"));
  const store = new MerchantStore(join(directory, "merchant.sqlite"));
  const apiToken = randomBytes(32).toString("base64url");
  const hmacKey = randomBytes(32).toString("hex");
  const network: PPOpsConfig["network"] = {
    railgunNetworkName: "DEMO",
    chainId: 42161,
    tokenAddress: "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
    tokenSymbol: "USDC",
    tokenDecimals: 6,
    rpcUrls: [],
    deploymentBlock: 0,
    finality: { mode: "finalized" },
  };
  const intents = new IntentService(
    database,
    network,
    "DEMO-NOT-A-PAYMENT-ADDRESS",
    Wallet.createRandom().privateKey,
  );
  const reconciliation = new ReconciliationService(database);
  const core = createApiApp({
    database,
    intents,
    apiToken,
    demo: true,
    health: () => ({
      railgunReady: true,
      startedAt: Math.floor(Date.now() / 1000),
      scanInProgress: false,
      consecutiveFailures: 0,
      scansSucceeded: 0,
      scansFailed: 0,
    }),
  });
  const client = new PPOpsClient({
    baseUrl: "http://127.0.0.1",
    apiToken,
    fetch: async (input, init) => core.request(String(input), init),
  });
  const merchant = createMerchantExample({
    client,
    store,
    webhookKeys: { v1: hmacKey },
    checkoutOrigin: "",
    demo: true,
  });
  const delivery = new WebhookDeliveryService(
    database,
    {
      url: "http://127.0.0.1/shop/webhooks/ppops",
      keyId: "v1",
      timeoutMs: 5000,
      maxAttempts: 3,
      baseRetryMs: 1000,
      maxRetryMs: 1000,
    },
    hmacKey,
    async (_input, init) => merchant.request("/webhooks/ppops", init),
  );
  const app = new Hono();
  app.get("/", (context) => context.redirect("/shop"));
  app.get("/shop/", (context) => context.redirect("/shop"));
  app.post("/demo/:id/confirm", async (context) => {
    if (context.req.header("content-type") !== "application/json")
      return context.json({ error: "Use application/json." }, 415);
    const origin = context.req.header("origin");
    if (origin && origin !== new URL(context.req.url).origin)
      return context.json({ error: "Use the local demo page." }, 403);
    const intent = intents.get(context.req.param("id"));
    if (!intent) return context.json({ error: "Demo intent not found." }, 404);
    const now = Math.floor(Date.now() / 1000);
    const transactionHash = `0x${"01".repeat(32)}`;
    reconciliation.reconcile(
      {
        uniqueSettlementId: `demo:${intent.id}`,
        chainId: 42161,
        txidVersion: "V2",
        tree: 0,
        position: 0,
        transactionHash,
        tokenAddress: network.tokenAddress,
        amountAtomic: intent.expectedAmountAtomic,
        blockNumber: 1,
        blockTimestamp: intent.createdAt,
        balanceBucket: "Spendable",
        rawPPOIStatuses: {},
        chainStatus: "FINALIZED",
        poiStatus: "SPENDABLE",
        reference: intent.reference,
      },
      now,
    );
    await delivery.deliverPending();
    return context.json({
      simulated: true,
      status: intents.requireView(intent.id).status,
    });
  });
  app.route("/shop", merchant);
  app.route("/", core);
  return {
    app,
    database,
    store,
    intents,
    reconciliation,
    delivery,
    client,
    close: async () => {
      database.close();
      store.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
};

export const startDemo = async (port = 8788) => {
  const demo = await createDemo();
  const server = serve({ fetch: demo.app.fetch, hostname: "127.0.0.1", port });
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  }).catch(async (error: unknown) => {
    await demo.close();
    throw error;
  });
  const address = server.address();
  const actualPort =
    typeof address === "object" && address ? address.port : port;
  process.stdout.write(
    `PPOps demo: http://127.0.0.1:${actualPort}/shop/\nSimulation only. No wallet or funds required. Temporary state is removed on exit.\n`,
  );
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await demo.close();
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  };
  const onSignal = () => {
    void stop();
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  return { port: actualPort, stop };
};
