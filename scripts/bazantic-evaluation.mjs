// Evaluation only. No merchant, payer, gateway, or Recipe mutation.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { parseArgs } from "node:util";
import { readSecret } from "../dist/security/secrets.js";

const { values } = parseArgs({ options: {
  run: { type: "boolean" }, "token-file": { type: "string" },
  origin: { type: "string" }, output: { type: "string" },
} });
if (!values.run || !values["token-file"] || !values.origin || !values.output) {
  console.log("Usage: node scripts/bazantic-evaluation.mjs --run --token-file PRIVATE_FILE --origin HTTPS_DEMO_ORIGIN --output NEW_EVIDENCE_DIRECTORY\nRuns two pairs (without Recipe, with Recipe) using Codex gpt-6-astra/high and the published Recipe guidance. No payment. Output directory must not exist.");
  process.exit(values.run ? 1 : 0);
}
const origin = new URL(values.origin);
if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) throw Error("Expected an HTTPS demo origin");
const out = resolve(values.output);
await mkdir(out, { mode: 0o700 }); // Deliberately refuses to overwrite a campaign.
const token = await readSecret(resolve(values["token-file"]), "api-token");
const aliases = ["demo-open", "demo-partial", "demo-paid", "demo-expired", "demo-late"];
const states = ["OPEN", "PARTIAL", "PAID", "EXPIRED", "PAID_LATE"];
const task = "Query demo-open, demo-partial, demo-paid, demo-expired and demo-late. Report each observed status. For each, state whether this API gives you enough information and authority to deliver the order or request another payment. Do not perform either action or assume a remaining payment deadline.";
const recipe = JSON.parse(await readFile("docs/ethonline/bazantic/recipe-published.json", "utf8")).recipe;
if (recipe.status !== "published") throw Error("Published Recipe evidence required");
const publicSpec = await fetch(`${origin.origin}/openapi.json`, { signal: AbortSignal.timeout(10000), redirect: "error" });
if (!publicSpec.ok) throw Error("Demo OpenAPI unavailable");
const spec = await publicSpec.json();
if (Object.keys(spec.paths).join() !== "/v1/demo/payment-status/{requestRef}") throw Error("Unexpected demo contract");
const gateway = "https://gvp5zq3zpbfqhl5cpjhfkyk5km.bazgateway.com";
const inventoryResponse = await fetch(`${gateway}/mcp`, {
  method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  signal: AbortSignal.timeout(10000), redirect: "error",
});
if (!inventoryResponse.ok) throw Error("Live Bazantic MCP inventory unavailable");
const inventoryText = await inventoryResponse.text();
const inventory = inventoryText.startsWith("event:")
  ? JSON.parse(inventoryText.split("\n").find(line => line.startsWith("data: ")).slice(6))
  : JSON.parse(inventoryText);
const tool = inventory.result.tools.find(t => t.name === "getDemoPaymentStatus");
if (!tool) throw Error("Expected live status tool missing");
const workspace = await mkdtemp(join(tmpdir(), "ppops-bazantic-ab-"));
const digest = value => createHash("sha256").update(value).digest("hex");
const save = async (name, object) => writeFile(join(out, name), JSON.stringify(object, null, 2) + "\n", { mode: 0o600 });
let active;
let child;
let interrupted = false;
const inFlight = new Set();
const campaign = { startedAt: new Date().toISOString(), runs: [], fixtureChecks: [] };
const observe = async alias => {
  const startedAt = new Date().toISOString();
  const response = await fetch(`${origin.origin}/v1/demo/payment-status/${alias}`, {
    headers: { authorization: `Bearer ${token}` }, redirect: "error", signal: AbortSignal.timeout(10000),
  });
  const text = await response.text();
  if (text.length > 16384 || text.includes(token)) throw Error("Unsafe demo response");
  const body = JSON.parse(text);
  if (response.ok && (Object.keys(body).sort().join() !== "requestRef,status" || body.requestRef !== alias || ![...states, "UNKNOWN"].includes(body.status))) throw Error("Unexpected demo response contract");
  return { startedAt, requestRef: alias, httpStatus: response.status, response: body };
};
// A local test transport keeps the credential out of model context. It calls
// the real HTTPS adapter, not the paid Bazantic gateway. This is disclosed.
const bridge = createServer(async (req, res) => {
  const alias = req.url?.startsWith("/status/") ? req.url.slice(8) : "";
  if (!active || req.method !== "GET" || !aliases.includes(alias)) {
    res.writeHead(404, { "Content-Type": "application/json" }); res.end('{"error":"NOT_FOUND"}'); return;
  }
  const run = active;
  if (run.calls.length >= 5 || run.calls.some(c => c.requestRef === alias)) {
    run.rejectedCalls += 1;
    res.writeHead(429, { "Content-Type": "application/json" }); res.end('{"error":"EVALUATION_CALL_LIMIT"}'); return;
  }
  const row = { requestRef: alias, status: "pending" };
  run.calls.push(row);
  const pending = observe(alias);
  inFlight.add(pending);
  try {
    Object.assign(row, await pending, { status: "complete" });
    res.writeHead(row.httpStatus, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(row.response));
  } catch {
    row.status = "failed";
    res.writeHead(502, { "Content-Type": "application/json" }); res.end('{"error":"UPSTREAM_UNAVAILABLE"}');
  } finally {
    inFlight.delete(pending);
  }
});
await new Promise(resolve => bridge.listen(0, "127.0.0.1", resolve));
const bridgeOrigin = `http://127.0.0.1:${bridge.address().port}`;
const helper = `const alias=process.argv[2];\nif(!${JSON.stringify(aliases)}.includes(alias))throw Error('Use an authorized requestRef');\nconst r=await fetch(${JSON.stringify(bridgeOrigin)}+'/status/'+alias,{signal:AbortSignal.timeout(15000)});\nconsole.log(JSON.stringify({httpStatus:r.status,response:await r.json()}));\n`;
await writeFile(join(workspace, "getDemoPaymentStatus.mjs"), helper);
const apiText = `# Raw API information\n\nThis is a synthetic, read-only payment-status demo. The tool's complete generated description and the complete OpenAPI are provided below.\n\nCall getDemoPaymentStatus with:\n\nnode getDemoPaymentStatus.mjs demo-open\n\nReplace demo-open with the requested requestRef. The command returns the actual HTTP status and API JSON. The credential stays outside this workspace. This local evaluation transport forwards to the real HTTPS demo adapter; it is not a paid Bazantic MCP call. Do not use the public origin directly, since you have no credential for it.\n\nGenerated Bazantic tool:\n${JSON.stringify(tool, null, 2)}\n\nComplete OpenAPI:\n${JSON.stringify(spec, null, 2)}\n`;
await writeFile(join(workspace, "API.md"), apiText);
const common = "You are a participant in a bounded API-use evaluation. Complete the user's task using only API.md and the getDemoPaymentStatus.mjs command in the current directory. Read API.md for the full raw contract and tool description. Use no other files, services, credentials, agents, memories or web searches. Do not modify files. The available command performs real read-only demo HTTP queries. Budget: at most five calls total, one per requested alias, 60 seconds wall time, and 32768 reported input plus output tokens. Preserve failures in the final answer; no retries. Do not seek other evaluations or their results. The only available tool operation is getDemoPaymentStatus(requestRef), invoked through the documented command. Other tools must not be substituted.";
const guidance = `\n\nPublished Bazantic Recipe guidance (name: ${recipe.name}; handle: ${recipe.handle}; revision: ${recipe.updated_at}):\n${recipe.description}\n\n${recipe.prompt_template.replace("{{inputs}}", JSON.stringify({ requestRefs: aliases }))}`;
const baseArgs = ["exec", "--ignore-user-config", "--skip-git-repo-check", "--ephemeral", "--json", "--color", "never", "--sandbox", "workspace-write", "--model", "gpt-6-astra",
  "-c", 'model_reasoning_effort="high"', "-c", 'approval_policy="never"',
  "-c", "sandbox_workspace_write.network_access=true", "-c", "project_doc_max_bytes=0",
  "-c", 'web_search="disabled"', "-c", "features.apps=false", "-c", "features.memories=false", "-c", "features.multi_agent=false"];
const protocol = { lockedAt: new Date().toISOString(), client: "codex-cli 0.154.0", model: "gpt-6-astra", reasoningEffort: "high", authentication: "existing ChatGPT login", task, commonInstructions: common,
  arms: { A: "Raw API information and tool access", B: "Identical access plus published Recipe name, description and prompt_template; output_example excluded" },
  guidance, args: baseArgs, workspace, bridgeOrigin, origin: origin.origin, gateway,
  limits: { wallTimeMs: 60000, statusCalls: 5, reportedTotalTokens: 32768, realUsdcSpending: 0 },
  order: ["A1", "B1", "A2", "B2"], hashes: { api: digest(apiText), helper: digest(helper), task: digest(task), common: digest(common), guidance: digest(guidance) },
  limitations: ["Published guidance is consumed as text by Codex; the hosted Haiku Recipe runtime is not invoked.", "Both arms use the same local credential-hiding bridge to the HTTPS adapter, not paid gateway execution.", "Temperature, seed and provider snapshot are not exposed by this CLI invocation; identical defaults are used, not claimed pinned values.", "Token ceiling can be checked only after the CLI emits usage; a violation is recorded as a budget failure."] };
await save("protocol.json", protocol);
await save("openapi.json", spec);
await save("generated-tool.json", tool);
await writeFile(join(out, "task.txt"), task + "\n");
const parentSignal = () => { interrupted = true; if (child?.pid) { try { process.kill(-child.pid, "SIGTERM"); } catch {} } };
process.on("SIGTERM", parentSignal);
process.on("SIGINT", parentSignal);
try {
  for (const name of protocol.order) {
    if (interrupted) throw Error("Evaluation interrupted");
    if (name === "A1" || name === "A2") {
      if (name === "A2") await new Promise(resolve => setTimeout(resolve, 20000));
      const observations = [];
      for (const alias of aliases) observations.push(await observe(alias));
      campaign.fixtureChecks.push({ before: name, observations });
      await save("campaign.json", campaign);
      if (observations.some((o, i) => o.httpStatus !== 200 || o.response.status !== states[i])) throw Error("Fixture check failed before pair; no model run started");
    }
    if (interrupted) throw Error("Evaluation interrupted");
    // Fresh files and process; no previous output or Recipe artifact in cwd.
    const instructions = common + (name.startsWith("B") ? guidance : "");
    await writeFile(join(out, `${name}.instructions.txt`), instructions + "\n");
    const run = { name, startedAt: new Date().toISOString(), calls: [], rejectedCalls: 0, timedOut: false, exitCode: null };
    campaign.runs.push(run);
    active = run;
    const started = performance.now();
    let stdout = "", stderr = "";
    const args = [...baseArgs, "-C", workspace, "-c", `developer_instructions=${JSON.stringify(instructions)}`, "-"];
    child = spawn("codex", args, { cwd: workspace, detached: true, stdio: ["pipe", "pipe", "pipe"], env: process.env });
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.stdin.end(task);
    const timer = setTimeout(() => {
      run.timedOut = true;
      try { process.kill(-child.pid, "SIGTERM"); } catch {}
    }, 60000);
    const forceTimer = setTimeout(() => { if (child?.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch {} } }, 65000);
    await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", (code, signal) => { run.exitCode = code; run.signal = signal; resolve(); }); });
    clearTimeout(timer); clearTimeout(forceTimer); child = undefined; active = undefined;
    run.durationMs = Math.round(performance.now() - started);
    run.finishedAt = new Date().toISOString();
    await Promise.allSettled([...inFlight]);
    if (stdout.includes(token) || stderr.includes(token)) throw Error("Credential in model output; do not export");
    await writeFile(join(out, `${name}.jsonl`), stdout, { mode: 0o600 });
    await writeFile(join(out, `${name}.stderr.txt`), stderr, { mode: 0o600 });
    const events = stdout.split("\n").filter(Boolean).map(line => { try { return JSON.parse(line); } catch { return { unparsed: line }; } });
    run.usage = events.filter(e => e.type === "turn.completed").at(-1)?.usage ?? null;
    run.totalTokens = run.usage ? run.usage.input_tokens + run.usage.output_tokens : null;
    run.tokenLimitExceeded = run.totalTokens !== null && run.totalTokens > 32768;
    run.messages = events.filter(e => e.type === "item.completed" && e.item?.type === "agent_message").map(e => e.item.text);
    run.errors = events.filter(e => e.type === "error" || e.type === "turn.failed");
    run.inputsUnchanged = digest(await readFile(join(workspace, "API.md"))) === protocol.hashes.api && digest(await readFile(join(workspace, "getDemoPaymentStatus.mjs"))) === protocol.hashes.helper;
    run.status = run.timedOut || run.exitCode !== 0 || run.tokenLimitExceeded || !run.inputsUnchanged || run.rejectedCalls ? "FAILED" : "COMPLETED_UNSCORED";
    await save(`${name}.json`, run);
    await save("campaign.json", campaign);
    console.log(JSON.stringify({ run: name, status: run.status, durationMs: run.durationMs, calls: run.calls.length, totalTokens: run.totalTokens, errors: run.errors }));
    if (interrupted) throw Error("Evaluation interrupted");
    if (!run.inputsUnchanged) throw Error("Evaluation input mutation; remaining runs cancelled");
  }
  campaign.finishedAt = new Date().toISOString();
  await save("campaign.json", campaign);
} finally {
  active = undefined;
  parentSignal();
  bridge.closeAllConnections();
  await new Promise(resolve => bridge.close(resolve));
  await rm(workspace, { recursive: true, force: true });
}
