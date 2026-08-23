import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";
import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";
import { z } from "zod";
import { formatUnits } from "ethers";

import type { PPOpsDatabase } from "../db/database.js";
import { memoForReference } from "../domain.js";
import type { HealthState } from "../operations/health.js";
import {
  IdempotencyConflictError,
  type IntentService,
} from "../intents/service.js";
import { bearerTokenMatches } from "../security/auth.js";
import { SignedPaymentDescriptorSchema } from "../security/descriptor.js";
import { FixedWindowRateLimiter } from "../security/rate-limit.js";

const CreateIntentSchema = z.object({
  externalReference: z.string().min(1).max(512),
  amountAtomic: z.string().regex(/^[1-9][0-9]*$/),
  expiresAt: z.number().int().positive(),
});

const PaginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(250).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

const IdempotencyKeySchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

const hasJsonContentType = (context: Context): boolean =>
  context.req.header("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ===
  "application/json";

const publicIntent = (intent: ReturnType<IntentService["requireView"]>) => ({
  id: intent.id,
  externalReference: intent.externalReference,
  chainId: intent.chainId,
  tokenAddress: intent.tokenAddress,
  tokenSymbol: intent.tokenSymbol,
  decimals: intent.decimals,
  expectedAmountAtomic: intent.expectedAmountAtomic,
  receivedAmountAtomic: intent.receivedAmountAtomic,
  pendingAmountAtomic: intent.pendingAmountAtomic,
  overpaymentAmountAtomic: intent.overpaymentAmountAtomic,
  status: intent.status,
  expiresAt: intent.expiresAt,
  createdAt: intent.createdAt,
  revision: intent.revision,
  checkoutPath: `/pay/${intent.id}`,
  payment: {
    rail: "railgun",
    recipient: intent.recipient0zk,
    memo: memoForReference(intent.reference),
    descriptor: intent.descriptor,
  },
});

const checkoutIntent = (intent: ReturnType<IntentService["requireView"]>) => ({
  id: intent.id,
  chainId: intent.chainId,
  tokenAddress: intent.tokenAddress,
  tokenSymbol: intent.tokenSymbol,
  decimals: intent.decimals,
  amountAtomic: intent.expectedAmountAtomic,
  amountFormatted: formatUnits(intent.expectedAmountAtomic, intent.decimals),
  receivedAmountAtomic: intent.receivedAmountAtomic,
  pendingAmountAtomic: intent.pendingAmountAtomic,
  status: intent.status,
  expiresAt: intent.expiresAt,
  rail: "railgun",
  recipient: intent.recipient0zk,
  memo: memoForReference(intent.reference),
  descriptor: intent.descriptor,
  expectedMerchantSigner: intent.descriptor.merchantSigner,
});

const CHECKOUT_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Private payment · PPOps</title>
  <link rel="stylesheet" href="/assets/pay.css">
</head>
<body>
  <main>
    <p class="eyebrow">PPOps · RAILGUN</p>
    <h1>Private payment request</h1>
    <p id="state" role="status">Loading signed payment details…</p>
    <section id="payment" hidden>
      <dl>
        <dt>Amount</dt><dd id="amount"></dd>
        <dt>Status</dt><dd id="status"></dd>
        <dt>Chain ID</dt><dd id="chain"></dd>
        <dt>Token</dt><dd id="token"></dd>
      </dl>
      <h2>RAILGUN recipient</h2><pre id="recipient"></pre>
      <button type="button" data-copy="recipient">Copy recipient</button>
      <h2>Encrypted memo</h2><pre id="memo"></pre>
      <button type="button" data-copy="memo">Copy memo</button>
      <details><summary>Signed descriptor and merchant identity</summary>
        <p>Verify the signer against a merchant identity obtained outside this page.</p>
        <pre id="signer"></pre><pre id="descriptor"></pre>
      </details>
      <p class="warning">Send the exact token and amount through a RAILGUN private transfer. PPOps never asks for a seed phrase or spending key.</p>
    </section>
  </main>
  <script src="/assets/pay.js" defer></script>
</body>
</html>`;

const CHECKOUT_CSS = `:root{color-scheme:dark;font-family:ui-sans-serif,system-ui,sans-serif;background:#0b1020;color:#edf2ff}body{margin:0;padding:2rem}main{max-width:46rem;margin:4vh auto;background:#121a30;border:1px solid #293553;border-radius:1rem;padding:clamp(1.25rem,4vw,2.5rem);box-shadow:0 1rem 4rem #0006}.eyebrow{color:#88a7ff;letter-spacing:.12em;font-size:.8rem}h1{font-size:clamp(2rem,6vw,3.5rem);line-height:1;margin:.4rem 0 2rem}h2{font-size:1rem;margin-top:2rem;color:#b8c8f8}dl{display:grid;grid-template-columns:7rem 1fr;gap:.75rem}dt{color:#9da9c7}dd{margin:0;font-weight:650}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#090d18;padding:1rem;border-radius:.5rem;color:#bfcced}button{border:0;border-radius:.45rem;padding:.7rem 1rem;background:#6588f5;color:#071020;font-weight:700;cursor:pointer}.warning{margin-top:2rem;padding:1rem;border-left:3px solid #f5c865;background:#191a23}details{margin-top:2rem}summary{cursor:pointer}`;

const CHECKOUT_JS = `"use strict";const byId=(id)=>document.getElementById(id);const fail=()=>{byId("state").textContent="Payment request unavailable."};const load=async()=>{try{const id=location.pathname.split("/").filter(Boolean).at(-1);const response=await fetch("/pay/"+encodeURIComponent(id)+"/request.json",{cache:"no-store",credentials:"omit"});if(!response.ok){fail();return}const data=await response.json();byId("amount").textContent=data.amountFormatted+" "+data.tokenSymbol;byId("status").textContent=data.status;byId("chain").textContent=String(data.chainId);byId("token").textContent=data.tokenAddress;byId("recipient").textContent=data.recipient;byId("memo").textContent=data.memo;byId("signer").textContent=data.expectedMerchantSigner;byId("descriptor").textContent=JSON.stringify(data.descriptor,null,2);byId("state").textContent="Signed request loaded.";byId("payment").hidden=false;document.querySelectorAll("[data-copy]").forEach((button)=>button.addEventListener("click",async()=>{const target=button.getAttribute("data-copy");const text=byId(target).textContent;await navigator.clipboard.writeText(text);button.textContent="Copied"}))}catch{fail()}};void load();`;

type RateLimitConfig = {
  apiPerMinute: number;
  authFailuresPerMinute: number;
  checkoutPerMinute: number;
};

const requestSource = (context: Context): string => {
  try {
    return getConnInfo(context).remote.address ?? "unknown";
  } catch {
    return "unknown";
  }
};

export const createApiApp = (dependencies: {
  intents: IntentService;
  database: PPOpsDatabase;
  apiToken: string;
  health: () => HealthState;
  rateLimit?: RateLimitConfig;
}): Hono => {
  const app = new Hono();
  const limits = dependencies.rateLimit ?? {
    apiPerMinute: 120,
    authFailuresPerMinute: 10,
    checkoutPerMinute: 60,
  };
  const apiLimiter = new FixedWindowRateLimiter(limits.apiPerMinute);
  const authFailureLimiter = new FixedWindowRateLimiter(limits.authFailuresPerMinute);
  const checkoutLimiter = new FixedWindowRateLimiter(limits.checkoutPerMinute);

  app.use("*", secureHeaders());

  app.use("/v1/*", async (context, next) => {
    context.header("cache-control", "no-store");
    await next();
  });

  app.use("/pay/*", async (context, next) => {
    const rate = checkoutLimiter.consume(requestSource(context));
    if (!rate.allowed) {
      context.header("retry-after", rate.retryAfterSeconds.toString());
      return context.json({ error: { code: "RATE_LIMITED" } }, 429);
    }
    context.header(
      "content-security-policy",
      "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    );
    context.header("cache-control", "no-store");
    context.header("referrer-policy", "no-referrer");
    await next();
  });

  app.get("/assets/pay.css", (context) => {
    context.header("content-type", "text/css; charset=utf-8");
    context.header("cache-control", "public, max-age=300");
    return context.body(CHECKOUT_CSS);
  });

  app.get("/assets/pay.js", (context) => {
    context.header("content-type", "text/javascript; charset=utf-8");
    context.header("cache-control", "public, max-age=300");
    return context.body(CHECKOUT_JS);
  });

  app.get("/pay/:id", (context) => {
    const intent = dependencies.intents.get(context.req.param("id"));
    if (!intent) return context.json({ error: { code: "NOT_FOUND" } }, 404);
    return context.html(CHECKOUT_HTML);
  });

  app.get("/pay/:id/request.json", (context) => {
    const intent = dependencies.intents.get(context.req.param("id"));
    if (!intent) return context.json({ error: { code: "NOT_FOUND" } }, 404);
    return context.json(checkoutIntent(intent));
  });

  app.onError((error, context) => {
    const status = error.message.includes("not found") ? 404 : 500;
    return context.json(
      { error: { code: status === 404 ? "NOT_FOUND" : "INTERNAL_ERROR" } },
      status,
    );
  });

  app.get("/v1/health", (context) => {
    const health = dependencies.health();
    return context.json({
      status: health.railgunReady ? "ready" : "starting",
      version: "0.1.0-beta.0",
      railgunReady: health.railgunReady,
      scanInProgress: health.scanInProgress,
      consecutiveFailures: health.consecutiveFailures,
      ...(health.lastScanAt ? { lastScanAt: health.lastScanAt } : {}),
      ...(health.lastScanError ? { degraded: true } : {}),
    });
  });

  app.get("/v1/live", (context) =>
    context.json({ status: "alive", version: "0.1.0-beta.0" }),
  );

  app.get("/v1/ready", (context) => {
    const health = dependencies.health();
    return context.json(
      {
        status: health.railgunReady ? "ready" : "not_ready",
        version: "0.1.0-beta.0",
        scanInProgress: health.scanInProgress,
        ...(health.lastScanAt ? { lastScanAt: health.lastScanAt } : {}),
      },
      health.railgunReady ? 200 : 503,
    );
  });

  app.use("/v1/*", async (context, next) => {
    const rate = apiLimiter.consume(requestSource(context));
    if (!rate.allowed) {
      context.header("retry-after", rate.retryAfterSeconds.toString());
      return context.json({ error: { code: "RATE_LIMITED" } }, 429);
    }
    await next();
  });

  app.use(
    "/v1/*",
    bodyLimit({
      maxSize: 64 * 1024,
      onError: (context) =>
        context.json({ error: { code: "REQUEST_TOO_LARGE" } }, 413),
    }),
  );

  app.use("/v1/*", async (context, next) => {
    if (!bearerTokenMatches(context.req.header("authorization"), dependencies.apiToken)) {
      const rate = authFailureLimiter.consume(requestSource(context));
      if (!rate.allowed) {
        context.header("retry-after", rate.retryAfterSeconds.toString());
        return context.json({ error: { code: "RATE_LIMITED" } }, 429);
      }
      return context.json({ error: { code: "UNAUTHORIZED" } }, 401);
    }
    await next();
  });

  app.post("/v1/intents", async (context) => {
    if (!hasJsonContentType(context)) {
      return context.json({ error: { code: "UNSUPPORTED_MEDIA_TYPE" } }, 415);
    }
    const idempotencyKey = IdempotencyKeySchema.safeParse(
      context.req.header("idempotency-key"),
    );
    if (!idempotencyKey.success) {
      return context.json({ error: { code: "IDEMPOTENCY_KEY_REQUIRED" } }, 400);
    }
    const parsed = CreateIntentSchema.safeParse(await context.req.json().catch(() => undefined));
    if (!parsed.success) {
      return context.json({ error: { code: "INVALID_REQUEST" } }, 400);
    }
    try {
      const result = await dependencies.intents.createIdempotent(
        parsed.data,
        idempotencyKey.data,
      );
      context.header("idempotent-replayed", result.replayed ? "true" : "false");
      return context.json(publicIntent(result.intent), result.replayed ? 200 : 201);
    } catch (error) {
      if (error instanceof IdempotencyConflictError) {
        return context.json({ error: { code: "IDEMPOTENCY_CONFLICT" } }, 409);
      }
      return context.json({ error: { code: "INVALID_INTENT" } }, 400);
    }
  });

  app.get("/v1/intents", (context) => {
    const pagination = PaginationSchema.safeParse(context.req.query());
    if (!pagination.success) {
      return context.json({ error: { code: "INVALID_PAGINATION" } }, 400);
    }
    const items = dependencies.intents
      .list(pagination.data.limit, pagination.data.offset)
      .map(publicIntent);
    return context.json({ items, ...pagination.data });
  });

  app.get("/v1/intents/:id", (context) => {
    const intent = dependencies.intents.get(context.req.param("id"));
    if (!intent) return context.json({ error: { code: "NOT_FOUND" } }, 404);
    return context.json(publicIntent(intent));
  });

  app.get("/v1/intents/:id/status", (context) => {
    const intent = dependencies.intents.get(context.req.param("id"));
    if (!intent) return context.json({ error: { code: "NOT_FOUND" } }, 404);
    return context.json({
      id: intent.id,
      status: intent.status,
      expectedAmountAtomic: intent.expectedAmountAtomic,
      receivedAmountAtomic: intent.receivedAmountAtomic,
      pendingAmountAtomic: intent.pendingAmountAtomic,
      overpaymentAmountAtomic: intent.overpaymentAmountAtomic,
      expiresAt: intent.expiresAt,
      revision: intent.revision,
    });
  });

  app.get("/v1/settlements", (context) => {
    const pagination = PaginationSchema.safeParse(context.req.query());
    if (!pagination.success) {
      return context.json({ error: { code: "INVALID_PAGINATION" } }, 400);
    }
    return context.json({
      items: dependencies.database.listSettlements(
        pagination.data.limit,
        pagination.data.offset,
      ),
      ...pagination.data,
    });
  });

  app.get("/v1/events", (context) => {
    const pagination = PaginationSchema.safeParse(context.req.query());
    if (!pagination.success) {
      return context.json({ error: { code: "INVALID_PAGINATION" } }, 400);
    }
    return context.json({
      items: dependencies.database.listEvents(
        pagination.data.limit,
        pagination.data.offset,
      ),
      ...pagination.data,
    });
  });

  app.get("/v1/outbox", (context) => {
    const pagination = PaginationSchema.safeParse(context.req.query());
    if (!pagination.success) {
      return context.json({ error: { code: "INVALID_PAGINATION" } }, 400);
    }
    return context.json({
      items: dependencies.database.listOutboxStatus(
        pagination.data.limit,
        pagination.data.offset,
      ),
      ...pagination.data,
    });
  });

  app.get("/v1/metrics", (context) => {
    const health = dependencies.health();
    const counts = dependencies.database.operationalCounts();
    const lines = [
      "# HELP ppops_ready Whether reconciliation is ready to confirm payments.",
      "# TYPE ppops_ready gauge",
      `ppops_ready ${health.railgunReady ? 1 : 0}`,
      "# TYPE ppops_scan_in_progress gauge",
      `ppops_scan_in_progress ${health.scanInProgress ? 1 : 0}`,
      "# TYPE ppops_scans_succeeded_total counter",
      `ppops_scans_succeeded_total ${health.scansSucceeded}`,
      "# TYPE ppops_scans_failed_total counter",
      `ppops_scans_failed_total ${health.scansFailed}`,
      "# TYPE ppops_scan_consecutive_failures gauge",
      `ppops_scan_consecutive_failures ${health.consecutiveFailures}`,
      "# TYPE ppops_last_scan_timestamp_seconds gauge",
      `ppops_last_scan_timestamp_seconds ${health.lastScanAt ?? 0}`,
      "# TYPE ppops_last_scan_duration_seconds gauge",
      `ppops_last_scan_duration_seconds ${(health.lastScanDurationMs ?? 0) / 1_000}`,
      "# TYPE ppops_intents gauge",
      `ppops_intents ${counts.intents}`,
      "# TYPE ppops_settlements gauge",
      `ppops_settlements ${counts.settlements}`,
      "# TYPE ppops_outbox_pending gauge",
      `ppops_outbox_pending ${counts.pendingEvents}`,
      "# TYPE ppops_outbox_dead_lettered gauge",
      `ppops_outbox_dead_lettered ${counts.deadLetteredEvents}`,
    ];
    context.header("content-type", "text/plain; version=0.0.4; charset=utf-8");
    context.header("cache-control", "no-store");
    return context.body(`${lines.join("\n")}\n`);
  });

  app.post("/v1/outbox/:eventId/replay", (context) => {
    const eventId = context.req.param("eventId");
    const existing = dependencies.database.getOutboxStatus(eventId);
    if (!existing) return context.json({ error: { code: "NOT_FOUND" } }, 404);
    if (
      !dependencies.database.replayDeadLetteredEvent(
        eventId,
        Math.floor(Date.now() / 1_000),
      )
    ) {
      return context.json({ error: { code: "EVENT_NOT_DEAD_LETTERED" } }, 409);
    }
    return context.json({ eventId, replayScheduled: true }, 202);
  });

  app.post("/v1/descriptors/verify", async (context) => {
    if (!hasJsonContentType(context)) {
      return context.json({ valid: false, error: { code: "UNSUPPORTED_MEDIA_TYPE" } }, 415);
    }
    const parsed = SignedPaymentDescriptorSchema.safeParse(
      await context.req.json().catch(() => undefined),
    );
    if (!parsed.success) {
      return context.json({ valid: false, error: { code: "INVALID_DESCRIPTOR" } }, 400);
    }
    try {
      const recoveredSigner = dependencies.intents.verifyDescriptor(parsed.data);
      return context.json({
        valid: true,
        recoveredSigner,
        expectedSigner: dependencies.intents.merchantSigner,
      });
    } catch {
      return context.json({ valid: false, error: { code: "UNTRUSTED_DESCRIPTOR" } }, 400);
    }
  });

  app.notFound((context) => context.json({ error: { code: "NOT_FOUND" } }, 404));
  return app;
};
