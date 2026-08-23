#!/usr/bin/env node

import { resolve } from "node:path";

import { serve } from "@hono/node-server";

import {
  createPilotWebhookReceiverApp,
  PilotWebhookStore,
} from "../src/pilot/webhook-receiver.js";
import { readSecret } from "../src/security/secrets.js";

const values = new Map<string, string>();
const allowed = new Set(["key-file", "key-id", "state-file", "port"]);
for (let index = 2; index < process.argv.length; index += 2) {
  const option = process.argv[index];
  const value = process.argv[index + 1];
  if (!option?.startsWith("--") || !value) {
    throw new Error("Pilot receiver options must use --name value pairs");
  }
  const name = option.slice(2);
  if (!allowed.has(name) || values.has(name)) {
    throw new Error(`Unsupported or repeated pilot receiver option: --${name}`);
  }
  values.set(name, value);
}

const keyFile = values.get("key-file");
if (!keyFile) throw new Error("Missing required option --key-file");
const stateFile = resolve(values.get("state-file") ?? "pilot-webhook.sqlite");
const keyId = values.get("key-id") ?? "v1";
if (!/^[A-Za-z0-9._-]{1,64}$/.test(keyId)) throw new Error("Invalid --key-id");
const port = Number(values.get("port") ?? 8790);
if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
  throw new Error("--port must be an integer from 1 to 65535");
}

const hmacKeyHex = await readSecret(resolve(keyFile), "webhook-hmac-key");
const store = new PilotWebhookStore(stateFile);
const app = createPilotWebhookReceiverApp({ hmacKeyHex, keyId, store });
const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port });
if ("requestTimeout" in server) server.requestTimeout = 30_000;
if ("headersTimeout" in server) server.headersTimeout = 10_000;
if ("maxHeadersCount" in server) server.maxHeadersCount = 64;
process.stdout.write(
  `${JSON.stringify({
    ok: true,
    listening: `http://127.0.0.1:${port}/webhooks/ppops`,
    stateFile,
    keyId,
    storesPayloads: false,
  })}\n`,
);

await new Promise<void>((resolveSignal) => {
  process.once("SIGINT", resolveSignal);
  process.once("SIGTERM", resolveSignal);
});
await new Promise<void>((resolveClose, rejectClose) => {
  server.close((error?: Error) => (error ? rejectClose(error) : resolveClose()));
});
store.close();
