import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { loadConfig } from "../dist/config.js";
import { readSecret } from "../dist/security/secrets.js";
import { safeCliFailureResult } from "../dist/security/failures.js";
import { PPOpsClient } from "../dist/client.js";
import { createMerchantExample, MerchantStore } from "../dist/examples/merchant.js";
import { CHECKOUT_CSS } from "../dist/api/checkout.js";

async function main() {
  const { values } = parseArgs({ options: { config: { type: "string", default: "./instance/ppops.config.json" }, port: { type: "string", default: "8790" }, database: { type: "string", default: "./data/example-merchant.sqlite" }, help: { type: "boolean" } } });
  if (values.help) {
    console.log("Usage: npm run example:merchant -- [--config PATH] [--port 8790] [--database PATH]\nLoopback-only example shop. Requires a configured PPOps daemon and webhook URL http://127.0.0.1:8790/shop/webhooks/ppops.");
    return;
  }
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid example port");
  const config = await loadConfig(resolve(values.config));
  if (!config.secrets.webhookHmacKeyFile || !config.webhook) throw new Error("Configure the merchant webhook before running this example");
  const origin = `http://127.0.0.1:${config.server.port}`;
  const apiToken = await readSecret(config.secrets.apiTokenFile, "api-token");
  const key = await readSecret(config.secrets.webhookHmacKeyFile, "webhook-hmac-key");
  const expectedWebhook = `http://127.0.0.1:${port}/shop/webhooks/ppops`;
  if (config.webhook.url !== expectedWebhook) throw new Error("Webhook URL must match the example's loopback port and /shop/webhooks/ppops path");
  const store = new MerchantStore(resolve(values.database));
  const app = new Hono();
  app.get("/", (c) => c.redirect("/shop"));
  app.get("/shop/", (c) => c.redirect("/shop"));
  app.get("/assets/pay.css", (c) => c.text(CHECKOUT_CSS, 200, { "content-type": "text/css" }));
  app.route("/shop", createMerchantExample({ client: new PPOpsClient({ baseUrl: origin, apiToken }), store, webhookKeys: { [config.webhook.keyId ?? "v1"]: key }, checkoutOrigin: origin }));
  const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port }, () => console.log(`Example shop: http://127.0.0.1:${port}/shop/\nDevelopment example; order IDs are not a replacement for application authentication.`));
  let stopped = false;
  const stop = () => { if (stopped) return; stopped = true; server.close(() => store.close()); };
  server.once("error", () => { store.close(); process.exitCode = 1; });
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
}
main().catch((error) => { console.error(JSON.stringify(safeCliFailureResult(error))); process.exitCode = 1; });
