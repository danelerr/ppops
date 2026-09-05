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
  IntentInputError,
  type IntentService,
} from "../intents/service.js";
import { bearerTokenMatches } from "../security/auth.js";
import { SignedPaymentDescriptorSchema } from "../security/descriptor.js";
import { FixedWindowRateLimiter } from "../security/rate-limit.js";
import { PPOPS_VERSION } from "../version.js";
import { CreateIntentSchema, requestIssues } from "./contracts.js";
import { openApiDocument } from "./openapi.js";

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

import { CHECKOUT_HTML, CHECKOUT_CSS, CHECKOUT_JS, PAYER_GUIDE_HTML } from "./checkout.js";

type RateLimitConfig = {
  apiPerMinute: number;
  authFailuresPerMinute: number;
  checkoutPerMinute: number;
};

type RuntimeInfo = {
  instanceId: string;
  chainId: number;
  tokenAddress: string;
  tokenSymbol: string;
  tokenDecimals: number;
  finalityMode: "finalized" | "confirmations";
  rpcProviderCount: number;
  ppoiConfiguredNodeCount: number;
};

const requestSource = (context: Context): string => {
  try {
    return getConnInfo(context).remote.address ?? "unknown";
  } catch {
    return "unknown";
  }
};

export const createApiApp = (dependencies: {
  demo?: boolean;
  intents: IntentService;
  database: PPOpsDatabase;
  apiToken: string;
  health: () => HealthState;
  runtimeInfo?: RuntimeInfo;
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
    return context.json({ ...checkoutIntent(intent), reconciliationReady: dependencies.health().railgunReady, ...(dependencies.demo ? { simulated: true } : {}) });
  });

  app.get("/payer-guide", (context) => context.html(PAYER_GUIDE_HTML));

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
      status: health.railgunReady ? "ready" : health.lastScanError || health.scanStalled || health.lastScanAt ? "degraded" : "starting",
      version: PPOPS_VERSION,
      railgunReady: health.railgunReady,
      scanInProgress: health.scanInProgress,
      consecutiveFailures: health.consecutiveFailures,
      ...(health.lastScanError ? { lastScanError: health.lastScanError } : {}),
      scanStalled: health.scanStalled ?? false,
      ...(health.lastScanAt ? { lastScanAt: health.lastScanAt } : {}),
      ...(health.syncProgress ? { syncProgress: health.syncProgress } : {}),
      ...(health.lastScanError || health.scanStalled ? { degraded: true } : {}),
    });
  });

  app.get("/v1/live", (context) =>
    context.json({ status: "alive", version: PPOPS_VERSION }),
  );

  app.get("/v1/ready", (context) => {
    const health = dependencies.health();
    return context.json(
      {
        status: health.railgunReady ? "ready" : "not_ready",
        version: PPOPS_VERSION,
        scanInProgress: health.scanInProgress,
        scanStalled: health.scanStalled ?? false,
        ...(health.syncProgress ? { syncProgress: health.syncProgress } : {}),
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

  app.get("/v1/runtime", (context) => {
    if (!dependencies.runtimeInfo) {
      return context.json({ error: { code: "RUNTIME_INFO_UNAVAILABLE" } }, 503);
    }
    return context.json({
      ...dependencies.runtimeInfo,
      startedAt: dependencies.health().startedAt,
    });
  });

  app.get("/v1/openapi.json", (context) => context.json(openApiDocument));

  app.post("/v1/intents", async (context) => {
    if (!hasJsonContentType(context)) {
      return context.json({ error: { code: "UNSUPPORTED_MEDIA_TYPE" } }, 415);
    }
    const idempotencyKey = IdempotencyKeySchema.safeParse(
      context.req.header("idempotency-key"),
    );
    if (!idempotencyKey.success) {
      return context.json({ error: { code: "IDEMPOTENCY_KEY_REQUIRED", hint: "Set Idempotency-Key to 8–128 letters, digits, dots, underscores, colons or hyphens. Reuse the same key and body when retrying." } }, 400);
    }
    const parsed = CreateIntentSchema.safeParse(await context.req.json().catch(() => undefined));
    if (!parsed.success) {
      return context.json({ error: { code: "INVALID_REQUEST", issues: requestIssues(parsed.error) } }, 400);
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
      if (error instanceof IntentInputError) {
        return context.json({ error: { code: "INVALID_INTENT", field: error.field, hint: error.message } }, 400);
      }
      return context.json({ error: { code: "INTERNAL_ERROR", hint: "Retry the same idempotency key and body. If the error persists, check daemon health." } }, 500);
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
      "# TYPE ppops_scan_stalled gauge",
      `ppops_scan_stalled ${health.scanStalled ? 1 : 0}`,
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
