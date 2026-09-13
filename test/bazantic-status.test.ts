import { afterEach, describe, expect, it, vi } from "vitest";
import { createApiApp } from "../src/api/app.js";
import { createDemo } from "../src/demo.js";
import { bazanticStatusOpenApi, createBazanticStatusApp } from "../src/examples/bazantic-status.js";

const upstreamToken = "u".repeat(43);
const gatewayToken = "g".repeat(43);
const id = "pi_" + "a".repeat(32);
const path = "/v1/demo/payment-status/demo-check";
const headers = { authorization: `Bearer ${gatewayToken}` };
const sentinel = "PRIVATE_SENTINEL_NOT_FOR_GATEWAY";
const options = {
  upstreamOrigin: "https://demo-upstream.example", upstreamToken, gatewayToken,
  aliases: { "demo-check": id }, publicOrigin: "https://demo-adapter.example",
};
const response = (status: unknown = "OPEN", extra = {}) => Response.json({ id, status, ...extra });
const setup = (result: () => Response | Promise<Response> = () => response()) => {
  const fetcher = vi.fn<typeof fetch>(async () => result());
  return { fetcher, app: createBazanticStatusApp({ ...options, fetch: fetcher }) };
};
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("Bazantic demo status boundary", () => {
  it.each(["OPEN", "PARTIAL", "PAID", "EXPIRED", "PAID_LATE"])("preserves %s and discards all other fields", async (status) => {
    const { app } = setup(() => response(status, {
      expiresAt: 1, amount: sentinel, memo: sentinel, descriptor: { secret: sentinel },
      futureUnrecognizedField: sentinel, viewingKey: sentinel,
    }));
    const res = await app.request(path, { headers });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ requestRef: "demo-check", status });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.has("access-control-allow-origin")).toBe(false);
  });

  it("uses only the fixed upstream, method and independent credential", async () => {
    const { app, fetcher } = setup();
    await app.request(path + "?host=https://ignored.example", { headers: {
      ...headers, "x-api-key": sentinel, "x-forwarded-host": "ignored.example",
      "if-none-match": sentinel,
    } });
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe(`https://demo-upstream.example/v1/intents/${id}/status`);
    expect(init).toMatchObject({ method: "GET", redirect: "error", cache: "no-store" });
    expect(init?.headers).toEqual({ authorization: `Bearer ${upstreamToken}`, accept: "application/json" });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("rejects missing/wrong credentials without calling upstream", async () => {
    const { app, fetcher } = setup();
    for (const authorization of [undefined, "Bearer wrong", `Bearer ${upstreamToken}`]) {
      const res = await app.request(path, { headers: authorization ? { authorization } : {} });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: { code: "UNAUTHORIZED" } });
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("hides unknown aliases and refuses all administrative and mutation routes", async () => {
    const { app, fetcher } = setup();
    for (const route of ["/v1/demo/payment-status/demo-other", "/v1/demo/payment-status/__proto__", "/v1/intents", "/v1/outbox", "/demo/test/confirm", "/v1/openapi.json"]) {
      const res = await app.request(route, { headers });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: { code: "NOT_FOUND" } });
    }
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]) {
      expect((await app.request(path, { method, headers })).status).toBe(404);
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("returns UNKNOWN only for a valid response with an unfamiliar string", async () => {
    const { app } = setup(() => response("NEW_UPSTREAM_STATE"));
    expect(await (await app.request(path, { headers })).json()).toEqual({ requestRef: "demo-check", status: "UNKNOWN" });
  });

  it.each([{}, [], null, { id, status: 1 }, { id, status: null }, { id: "wrong", status: "PAID" }, { status: "PAID" }])("rejects malformed or mismatched upstream %#", async (body) => {
    const { app } = setup(() => Response.json(body));
    const res = await app.request(path, { headers });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: { code: "UPSTREAM_UNAVAILABLE" } });
  });

  it.each([401, 403, 404, 429, 500, 302])("sanitizes upstream HTTP %s", async (status) => {
    const { app } = setup(() => new Response(sentinel, { status, headers: { location: "https://private.example" } }));
    const res = await app.request(path, { headers });
    expect(res.status).toBe(status === 404 ? 404 : 502);
    expect(await res.json()).toEqual({ error: { code: status === 404 ? "NOT_FOUND" : "UPSTREAM_UNAVAILABLE" } });
  });

  it("does not log exceptions, echo invalid JSON or return a cached paid response", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { app, fetcher } = setup(() => response("PAID"));
    expect((await (await app.request(path, { headers })).json()).status).toBe("PAID");
    fetcher.mockRejectedValueOnce(new Error(sentinel, { cause: gatewayToken }));
    const failed = await app.request(path, { headers });
    expect(await failed.json()).toEqual({ error: { code: "UPSTREAM_UNAVAILABLE" } });
    fetcher.mockResolvedValueOnce(new Response(sentinel));
    expect((await app.request(path, { headers })).status).toBe(502);
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("limits declared and streamed upstream bodies", async () => {
    for (const declared of [true, false]) {
      const cancel = vi.fn();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) { controller.enqueue(new TextEncoder().encode("x".repeat(16_385))); },
        cancel,
      });
      const { app } = setup(() => new Response(stream, { headers: declared ? { "content-length": "16385" } : {} }));
      expect((await app.request(path, { headers })).status).toBe(502);
      expect(cancel).toHaveBeenCalledOnce();
    }
  });

  it("passes a five-second abort signal and sanitizes timeout", async () => {
    // AbortSignal.timeout uses Node timers, so inspect its actual requested duration.
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    let started!: () => void;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error(sentinel)), { once: true });
      started();
    }));
    const app = createBazanticStatusApp({ ...options, fetch: fetcher });
    const pending = app.request(path, { headers });
    await ready;
    controller.abort();
    expect((await pending).status).toBe(502);
    expect(timeout).toHaveBeenCalledWith(5_000);
  });

  it("caps calls at 30 per minute without trusting forwarding headers", async () => {
    vi.useFakeTimers();
    const { app, fetcher } = setup();
    for (let n = 0; n < 30; n++) expect((await app.request(path, { headers })).status).toBe(200);
    const limited = await app.request(path, { headers: { ...headers, "x-forwarded-for": "198.51.100.2" } });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: { code: "RATE_LIMITED" } });
    expect(fetcher).toHaveBeenCalledTimes(30);
    vi.advanceTimersByTime(60_001);
    expect((await app.request(path, { headers })).status).toBe(200);
  });

  it("publishes a one-operation spec with full semantics and no upstream data", async () => {
    const { app, fetcher } = setup();
    const res = await app.request("/openapi.json");
    const spec = await res.json();
    expect(res.status).toBe(200);
    expect(Object.keys(spec.paths)).toEqual(["/v1/demo/payment-status/{requestRef}"]);
    const operation = spec.paths["/v1/demo/payment-status/{requestRef}"].get;
    expect(operation.security).toEqual([{ gatewayBearer: [] }]);
    expect(operation.responses[200].content["application/json"].schema.additionalProperties).toBe(false);
    const text = JSON.stringify(spec);
    for (const secret of [id, upstreamToken, gatewayToken, options.upstreamOrigin]) expect(text).not.toContain(secret);
    expect(text).toContain("possibly past expiry");
    expect(text).toContain("PAID_LATE");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects unsafe configuration and copies its allowlist", async () => {
    for (const upstreamOrigin of ["http://remote.example", "https://user:pass@example.com", "https://example.com/path", "https://example.com/?token=x"]) {
      expect(() => createBazanticStatusApp({ ...options, upstreamOrigin })).toThrow();
    }
    expect(() => bazanticStatusOpenApi("javascript:alert(1)")).toThrow();
    expect(() => createBazanticStatusApp({ ...options, gatewayToken: upstreamToken })).toThrow();
    expect(() => createBazanticStatusApp({ ...options, aliases: { "demo-check": "../outbox" } })).toThrow();
    const aliases = { "demo-check": id };
    const app = createBazanticStatusApp({ ...options, aliases, fetch: async () => response() });
    aliases["demo-check"] = "pi_" + "b".repeat(32);
    expect((await app.request(path, { headers })).status).toBe(200);
  });

  it("reads the real isolated PPOps API and observes reconciliation without exposing the demo app", async () => {
    const demo = await createDemo();
    try {
      const intent = await demo.client.createIntent({ externalReference: sentinel, amountAtomic: "10000", expiresAt: Math.floor(Date.now()/1000)+3600 }, "bazantic-integration-fixture");
      const upstream = createApiApp({ database: demo.database, intents: demo.intents, apiToken: upstreamToken, demo: true,
        health: () => ({ railgunReady: true, startedAt: 0, scanInProgress: false, consecutiveFailures: 0, scansSucceeded: 0, scansFailed: 0 }) });
      const app = createBazanticStatusApp({ ...options, aliases: { "demo-check": intent.id }, fetch: async (input, init) => upstream.request(String(input), init) });
      expect(await (await app.request(path, { headers })).json()).toEqual({ requestRef: "demo-check", status: "OPEN" });
      expect((await app.request(`/demo/${intent.id}/confirm`, { method: "POST", headers })).status).toBe(404);
      await demo.app.request(`/demo/${intent.id}/confirm`, { method: "POST", headers: { "content-type": "application/json" } });
      expect(await (await app.request(path, { headers })).json()).toEqual({ requestRef: "demo-check", status: "PAID" });
    } finally { await demo.close(); }
  });
});
