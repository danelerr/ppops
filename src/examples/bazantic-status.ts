import { Hono } from "hono";
import { bearerTokenMatches } from "../security/auth.js";
import { readResponseTextLimited } from "../security/http.js";
import { FixedWindowRateLimiter } from "../security/rate-limit.js";

const statuses = ["OPEN", "PARTIAL", "PAID", "EXPIRED", "PAID_LATE", "UNKNOWN"] as const;
const aliasPattern = /^demo-[a-z0-9-]{1,48}$/;
const tokenPattern = /^[A-Za-z0-9_-]{43,128}$/;

/** Operator configuration only; no caller can choose an upstream URL. */
const checkedOrigin = (value: string): string => {
  const url = new URL(value);
  const loopback = ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
    url.username || url.password || url.search || url.hash || url.pathname !== "/"
  ) throw new Error("Use an HTTPS origin or loopback HTTP origin without credentials or a path");
  return url.origin;
};

/** Public documentation contains no upstream credentials, IDs or request data. */
export const bazanticStatusOpenApi = (publicOrigin: string) => ({
  openapi: "3.1.0",
  info: {
    title: "PPOps demo payment status",
    version: "1.0.0",
    description: "Isolated simulation. Read-only observations; this service cannot pay or fulfill orders.",
  },
  servers: [{ url: checkedOrigin(publicOrigin) }],
  paths: {
    "/v1/demo/payment-status/{requestRef}": {
      get: {
        operationId: "getDemoPaymentStatus",
        summary: "Read one authorized demo request status",
        description: "OPEN: observed open; no remaining-time guarantee. PARTIAL: partial payment, possibly past expiry; do not instruct another payment. PAID: reconciler reports paid, no delivery action authorized. EXPIRED: expired, later payment remains possible. PAID_LATE: paid late, merchant policy required. UNKNOWN: uninterpretable state; infer neither paid nor unpaid. Each result is a fresh observation and may change. No timestamps or merchant policy are available.",
        security: [{ gatewayBearer: [] }],
        parameters: [{ name: "requestRef", in: "path", required: true, schema: { type: "string", pattern: aliasPattern.source, maxLength: 53 }, example: "demo-open" }],
        responses: {
          "200": {
            description: "Current demo observation; never permission to take a business action",
            content: { "application/json": { schema: {
              type: "object", additionalProperties: false, required: ["requestRef", "status"],
              properties: { requestRef: { type: "string", pattern: aliasPattern.source }, status: { type: "string", enum: statuses } },
            } } },
          },
          ...Object.fromEntries([
            ["401", "UNAUTHORIZED"], ["404", "NOT_FOUND"], ["429", "RATE_LIMITED"],
            ["502", "UPSTREAM_UNAVAILABLE"], ["503", "UPSTREAM_UNAVAILABLE"],
          ].map(([code, name]) => [code, {
            description: name,
            content: { "application/json": { schema: {
              type: "object", additionalProperties: false, required: ["error"],
              properties: { error: { type: "object", additionalProperties: false, required: ["code"], properties: { code: { type: "string", const: name } } } },
            } } },
          }])),
        },
      },
    },
  },
  components: { securitySchemes: { gatewayBearer: { type: "http", scheme: "bearer" } } },
});

export type BazanticStatusOptions = {
  upstreamOrigin: string;
  upstreamToken: string;
  gatewayToken: string;
  aliases: Readonly<Record<string, string>>;
  publicOrigin: string;
  fetch?: typeof fetch;
};

/** Opt-in demo adapter; never imported by the merchant runtime. */
export const createBazanticStatusApp = (options: BazanticStatusOptions) => {
  const upstreamOrigin = checkedOrigin(options.upstreamOrigin);
  const spec = bazanticStatusOpenApi(options.publicOrigin);
  const { upstreamToken, gatewayToken } = options;
  if (!tokenPattern.test(upstreamToken) || !tokenPattern.test(gatewayToken) || upstreamToken === gatewayToken) {
    throw new Error("Use distinct valid demo bearer credentials");
  }
  const aliases = new Map(Object.entries(options.aliases));
  if (aliases.size === 0 || aliases.size > 100 || [...aliases].some(([alias, id]) =>
    !aliasPattern.test(alias) || !/^pi_[0-9a-f]{32}$/.test(id)
  )) throw new Error("Use a bounded allowlist of demo aliases and valid intent IDs");
  const fetchUpstream = options.fetch ?? fetch;
  // One bounded bucket for the demo, independent of spoofable forwarding headers.
  const limiter = new FixedWindowRateLimiter(30);
  const app = new Hono();
  app.onError((_error, c) => c.json({ error: { code: "UPSTREAM_UNAVAILABLE" } }, 502));
  app.notFound((c) => c.json({ error: { code: "NOT_FOUND" } }, 404));
  app.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    c.header("X-Content-Type-Options", "nosniff");
    const rate = limiter.consume("demo");
    if (!rate.allowed) {
      c.header("Retry-After", String(rate.retryAfterSeconds));
      return c.json({ error: { code: "RATE_LIMITED" } }, 429);
    }
    // The public spec is documentation only, and is not an MCP operation.
    if (c.req.method === "GET" && c.req.path === "/openapi.json") return next();
    if (!bearerTokenMatches(c.req.header("authorization"), gatewayToken)) {
      return c.json({ error: { code: "UNAUTHORIZED" } }, 401);
    }
    if (c.req.method !== "GET") return c.json({ error: { code: "NOT_FOUND" } }, 404);
    return next();
  });
  app.get("/openapi.json", (c) => c.json(spec));
  app.get("/v1/demo/payment-status/:requestRef", async (c) => {
    const requestRef = c.req.param("requestRef");
    const id = aliases.get(requestRef);
    if (!id) return c.json({ error: { code: "NOT_FOUND" } }, 404);
    try {
      const response = await fetchUpstream(`${upstreamOrigin}/v1/intents/${id}/status`, {
        method: "GET",
        headers: { authorization: `Bearer ${upstreamToken}`, accept: "application/json" },
        signal: AbortSignal.timeout(5_000),
        redirect: "error",
        cache: "no-store",
      });
      if (!response.ok) {
        await response.body?.cancel();
        return response.status === 404
          ? c.json({ error: { code: "NOT_FOUND" } }, 404)
          : c.json({ error: { code: "UPSTREAM_UNAVAILABLE" } }, 502);
      }
      const body: unknown = JSON.parse(await readResponseTextLimited(response, 16_384, "Demo status"));
      if (!body || typeof body !== "object" || Array.isArray(body) ||
        !("id" in body) || body.id !== id || !("status" in body) || typeof body.status !== "string") {
        return c.json({ error: { code: "UPSTREAM_UNAVAILABLE" } }, 502);
      }
      const status = statuses.find((known) => known === body.status) ?? "UNKNOWN";
      return c.json({ requestRef, status });
    } catch {
      // Never forward raw SDK/network errors, bodies, URLs or credentials.
      return c.json({ error: { code: "UPSTREAM_UNAVAILABLE" } }, 502);
    }
  });
  return app;
};
