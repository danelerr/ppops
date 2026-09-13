import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";

// Run after npm run build. Only disposable local data and loopback HTTP.
const directory = await mkdtemp(join(tmpdir(), "ppops-bazantic-smoke-"));
const token = randomBytes(32).toString("base64url");
const tokenFile = join(directory, "gateway-token");
await writeFile(tokenFile, token + "\n", { mode: 0o600, flag: "wx" });
const probe = createServer();
probe.listen(0, "127.0.0.1");
await once(probe, "listening");
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const child = spawn(process.execPath, ["examples/bazantic-status.mjs", "--token-file", tokenFile, "--port", String(port)], { stdio: ["ignore", "pipe", "pipe"] });
const exited = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
let output = "";
let timedOut = false;
const deadline = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, 15_000);
try {
  await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", () => reject(new Error("Demo exited before readiness")));
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
      if (output.includes("demo listening")) resolve();
    });
    child.stderr.on("data", (chunk) => { output += chunk.toString(); });
  });
  const base = `http://127.0.0.1:${port}`;
  const get = (path, authenticated = true, method = "GET") => fetch(base + path, {
    method, headers: authenticated ? { authorization: `Bearer ${token}` } : {},
    redirect: "error", signal: AbortSignal.timeout(3_000),
  });
  assert.equal((await get("/v1/demo/payment-status/demo-open", false)).status, 401);
  for (const [alias, status] of Object.entries({ "demo-open": "OPEN", "demo-partial": "PARTIAL", "demo-paid": "PAID", "demo-expired": "EXPIRED", "demo-late": "PAID_LATE" })) {
    const response = await get(`/v1/demo/payment-status/${alias}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { requestRef: alias, status });
  }
  for (const path of ["/v1/intents", "/demo/demo-paid/confirm", "/v1/demo/payment-status/demo-other"]) {
    assert.equal((await get(path)).status, 404);
  }
  assert.equal((await get("/v1/demo/payment-status/demo-open", true, "POST")).status, 404);
  const spec = await (await get("/openapi.json", false)).json();
  assert.deepEqual(Object.keys(spec.paths), ["/v1/demo/payment-status/{requestRef}"]);
  assert(!JSON.stringify(spec).includes(token));
  child.kill("SIGTERM");
  assert.deepEqual(await exited, { code: 0, signal: null });
  assert(!timedOut);
  assert(!output.includes(token));
  console.log(JSON.stringify({ result: "PASS", environment: "loopback HTTP; synthetic settlements", statuses: ["OPEN", "PARTIAL", "PAID", "EXPIRED", "PAID_LATE"], unauthenticated: 401, forbiddenRoutes: 404, publicOperations: 1, shutdown: "clean", realPayment: false, gatewayPublished: false }));
} finally {
  if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await exited; }
  clearTimeout(deadline);
  await rm(directory, { recursive: true, force: true });
}
