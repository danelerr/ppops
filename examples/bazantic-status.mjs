import { parseArgs } from "node:util";
import { randomBytes } from "node:crypto";
import { serve } from "@hono/node-server";
import { createDemo } from "../dist/demo.js";
import { createApiApp } from "../dist/api/app.js";
import { readSecret } from "../dist/security/secrets.js";
import { createBazanticStatusApp, bazanticStatusOpenApi } from "../dist/examples/bazantic-status.js";

async function main() {
  const { values } = parseArgs({ options: {
    "token-file": { type: "string" }, port: { type: "string", default: "8791" },
    "public-origin": { type: "string" }, spec: { type: "boolean" }, help: { type: "boolean" },
  } });
  if (values.help) {
    console.log("Usage: node examples/bazantic-status.mjs --token-file PATH [--port 8791] [--public-origin HTTPS_ORIGIN]\n       node examples/bazantic-status.mjs --spec --public-origin HTTPS_ORIGIN\nLoopback-only isolated simulation. Exposes authenticated demo status and public /openapi.json. No real payments, RPC, wallets or production configuration. Aliases: demo-open, demo-partial, demo-paid, demo-expired, demo-late. Credentials are never printed.");
    return;
  }
  const port = Number(values.port);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error("Invalid port");
  const publicOrigin = values["public-origin"] ?? `http://127.0.0.1:${port}`;
  const spec = bazanticStatusOpenApi(publicOrigin);
  if (values.spec) { console.log(JSON.stringify(spec, null, 2)); return; }
  if (!values["token-file"]) throw new Error("Token file required");
  const gatewayToken = await readSecret(values["token-file"], "api-token");
  const upstreamToken = randomBytes(32).toString("base64url");
  const demo = await createDemo();
  let server;
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    if (server) {
      const closed = new Promise((resolve) => server.close(resolve));
      server.closeAllConnections();
      await closed;
    }
    await demo.close();
  };
  try {
    const now = Math.floor(Date.now() / 1000);
    const aliases = {};
    for (const [index, name] of ["open", "partial", "paid", "expired", "late"].entries()) {
      const intent = await demo.intents.create({
        externalReference: `bazantic-synthetic-${name}`, amountAtomic: "10000",
        expiresAt: name === "open" || name === "paid" ? now + 3600 : now - 60,
      }, now - 120);
      aliases[`demo-${name}`] = intent.id;
      if (["partial", "paid", "late"].includes(name)) {
        demo.reconciliation.reconcile({
          uniqueSettlementId: `bazantic-synthetic:${index}`, chainId: 42161,
          txidVersion: "V2", tree: 0, position: index,
          transactionHash: `0x${String(index + 1).padStart(64, "0")}`,
          tokenAddress: "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
          amountAtomic: name === "partial" ? "5000" : "10000",
          blockNumber: index + 1, blockTimestamp: now, balanceBucket: "Spendable",
          rawPPOIStatuses: {}, chainStatus: "FINALIZED", poiStatus: "SPENDABLE",
          reference: intent.reference,
        }, now);
      }
    }
    demo.reconciliation.refreshExpirations(now);
    // This app is never mounted or given a listening socket. Its credential is
    // created here and stays in this process; incoming gateway headers are ignored.
    const upstream = createApiApp({
      database: demo.database, intents: demo.intents, apiToken: upstreamToken, demo: true,
      health: () => ({ railgunReady: true, startedAt: now, scanInProgress: false,
        consecutiveFailures: 0, scansSucceeded: 0, scansFailed: 0 }),
    });
    const app = createBazanticStatusApp({
      upstreamOrigin: "http://127.0.0.1", upstreamToken, gatewayToken, aliases, publicOrigin,
      fetch: async (input, init) => upstream.request(String(input), init),
    });
    server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port });
    await new Promise((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    server.on("error", () => { console.error("Bazantic demo server failed."); process.exitCode = 1; void stop(); });
    process.once("SIGINT", () => void stop());
    process.once("SIGTERM", () => void stop());
    console.log(`PPOps Bazantic demo listening on http://127.0.0.1:${port}\nSimulation only: five synthetic states; no onchain payment. Public documentation: /openapi.json. Gateway and Recipe are managed separately in Bazantic.`);
  } catch {
    await stop();
    throw new Error("Demo startup failed");
  }
}
main().catch(() => { console.error("Bazantic demo could not start. Check options, build, port and private token file; no secret values are logged."); process.exitCode = 1; });
