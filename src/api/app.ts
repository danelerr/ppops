import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";
import { z } from "zod";

import type { PPOpsDatabase } from "../db/database.js";
import { memoForReference } from "../domain.js";
import type { IntentService } from "../intents/service.js";
import { bearerTokenMatches } from "../security/auth.js";
import { SignedPaymentDescriptorSchema } from "../security/descriptor.js";

const CreateIntentSchema = z.object({
  externalReference: z.string().min(1).max(512),
  amountAtomic: z.string().regex(/^[1-9][0-9]*$/),
  expiresAt: z.number().int().positive(),
});

const PaginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(250).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

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
  payment: {
    rail: "railgun",
    recipient: intent.recipient0zk,
    memo: memoForReference(intent.reference),
    descriptor: intent.descriptor,
  },
});

export type HealthState = {
  railgunReady: boolean;
  lastScanAt?: number;
  lastScanError?: string;
};

export const createApiApp = (dependencies: {
  intents: IntentService;
  database: PPOpsDatabase;
  apiToken: string;
  health: () => HealthState;
}): Hono => {
  const app = new Hono();

  app.use("*", secureHeaders());

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
      ...(health.lastScanAt ? { lastScanAt: health.lastScanAt } : {}),
      ...(health.lastScanError ? { degraded: true } : {}),
    });
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
      return context.json({ error: { code: "UNAUTHORIZED" } }, 401);
    }
    await next();
  });

  app.post("/v1/intents", async (context) => {
    const parsed = CreateIntentSchema.safeParse(await context.req.json().catch(() => undefined));
    if (!parsed.success) {
      return context.json({ error: { code: "INVALID_REQUEST" } }, 400);
    }
    try {
      const intent = await dependencies.intents.create(parsed.data);
      return context.json(publicIntent(intent), 201);
    } catch (error) {
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

  app.post("/v1/descriptors/verify", async (context) => {
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
