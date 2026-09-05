import { z } from "zod";
import {
  AtomicAmountSchema,
  CheckoutHttpSchema,
  CreateIntentSchema,
  DescriptorHttpSchema,
  EventSchema,
  IntentHttpSchema,
  IntentProjectionHttpSchema,
  OutboxHttpSchema,
  SettlementHttpSchema,
} from "./contracts.js";
import { PPOPS_VERSION } from "../version.js";

const schemas = {
  CreateIntent: CreateIntentSchema,
  Intent: IntentHttpSchema,
  IntentStatus: IntentProjectionHttpSchema,
  CheckoutRequest: CheckoutHttpSchema,
  Descriptor: DescriptorHttpSchema,
  Event: EventSchema,
  Settlement: SettlementHttpSchema,
  Outbox: OutboxHttpSchema,
  Error: z.object({
    error: z.object({
      code: z.string(),
      hint: z.string().optional(),
      field: z.string().optional(),
      issues: z
        .array(z.object({ field: z.string(), hint: z.string() }))
        .optional(),
    }),
    valid: z.literal(false).optional(),
  }),
  Runtime: z.object({
    instanceId: z.string(),
    chainId: z.number().int(),
    tokenAddress: z.string(),
    tokenSymbol: z.string(),
    tokenDecimals: z.number().int(),
    finalityMode: z.enum(["finalized", "confirmations"]),
    rpcProviderCount: z.number().int(),
    ppoiConfiguredNodeCount: z.number().int(),
    startedAt: z.number().int(),
  }),
  Health: z.object({
    status: z.enum(["ready", "starting", "degraded"]),
    version: z.string(),
    railgunReady: z.boolean(),
    scanInProgress: z.boolean(),
    consecutiveFailures: z.number().int(),
    scanStalled: z.boolean(),
    lastScanAt: z.number().int().optional(),
    lastScanError: z.string().optional(),
    syncProgress: z.record(z.string(), z.unknown()).optional(),
    degraded: z.boolean().optional(),
  }),
  Ready: z.object({
    status: z.enum(["ready", "not_ready"]),
    version: z.string(),
    scanInProgress: z.boolean(),
    scanStalled: z.boolean(),
    lastScanAt: z.number().int().optional(),
    syncProgress: z.record(z.string(), z.unknown()).optional(),
  }),
  Live: z.object({ status: z.literal("alive"), version: z.string() }),
  Replay: z.object({ eventId: z.string(), replayScheduled: z.literal(true) }),
  Verification: z.object({
    valid: z.literal(true),
    recoveredSigner: z.string(),
    expectedSigner: z.string(),
  }),
  AtomicAmount: AtomicAmountSchema,
};
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema: unknown) => ({ "application/json": { schema } });
const response = (schema: unknown, description = "Success") => ({
  description,
  content: json(schema),
});
const error = response(
  ref("Error"),
  "Request could not be completed; inspect the stable code and optional hint.",
);
const body = (name: string) => ({ required: true, content: json(ref(name)) });
const id = (name = "id") => ({
  name,
  in: "path",
  required: true,
  schema: { type: "string" },
});
const pagination = [
  {
    name: "limit",
    in: "query",
    schema: { type: "integer", minimum: 1, maximum: 250, default: 100 },
  },
  {
    name: "offset",
    in: "query",
    schema: { type: "integer", minimum: 0, default: 0 },
  },
];
const list = (name: string) => ({
  type: "object",
  required: ["items", "limit", "offset"],
  properties: {
    items: { type: "array", items: ref(name) },
    limit: { type: "integer" },
    offset: { type: "integer" },
  },
});
const get = (schema: unknown, extra: Record<string, unknown> = {}) => ({
  responses: {
    "200": response(schema),
    "400": error,
    "401": error,
    "404": error,
    "429": error,
  },
  ...extra,
});

export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "PPOps merchant API",
    version: PPOPS_VERSION,
    description:
      "One merchant receiver, network and token per instance. Amounts are integer atomic-unit strings; timestamps are Unix seconds. Webhooks are at-least-once. See docs/PAYMENT-STATES.md for expiry and settlement semantics.",
  },
  servers: [
    { url: "http://127.0.0.1:8787", description: "Local merchant daemon" },
  ],
  security: [{ bearerAuth: [] }],
  paths: {
    "/v1/live": { get: get(ref("Live"), { security: [] }) },
    "/v1/ready": {
      get: {
        security: [],
        responses: {
          "200": response(ref("Ready")),
          "503": response(ref("Ready"), "A complete recent scan is required."),
        },
      },
    },
    "/v1/health": { get: get(ref("Health"), { security: [] }) },
    "/pay/{id}": {
      get: {
        security: [],
        parameters: [id()],
        responses: {
          "200": {
            description: "Payer checkout",
            content: { "text/html": { schema: { type: "string" } } },
          },
          "404": error,
          "429": error,
        },
      },
    },
    "/pay/{id}/request.json": {
      get: get(ref("CheckoutRequest"), {
        security: [],
        parameters: [id()],
        description:
          "Minimal signed request. The wallet must verify the signer through an independent trusted channel.",
      }),
    },
    "/v1/intents": {
      post: {
        parameters: [
          {
            name: "Idempotency-Key",
            in: "header",
            required: true,
            schema: {
              type: "string",
              minLength: 8,
              maxLength: 128,
              pattern: "^[A-Za-z0-9._:-]+$",
            },
          },
        ],
        requestBody: body("CreateIntent"),
        responses: {
          "201": {
            ...response(ref("Intent"), "Created"),
            headers: {
              "Idempotent-Replayed": {
                schema: { type: "string", enum: ["false"] },
              },
            },
          },
          "200": {
            ...response(ref("Intent"), "Exact request replay"),
            headers: {
              "Idempotent-Replayed": {
                schema: { type: "string", enum: ["true"] },
              },
            },
          },
          "400": error,
          "401": error,
          "409": error,
          "413": error,
          "415": error,
          "429": error,
          "500": error,
        },
      },
      get: get(list("Intent"), {
        parameters: pagination,
        description:
          "Newest creation first. No total or filters. Continue with offset + items.length until a short page; offset pagination is not a consistent snapshot.",
      }),
    },
    "/v1/intents/{id}": { get: get(ref("Intent"), { parameters: [id()] }) },
    "/v1/intents/{id}/status": {
      get: get(ref("IntentStatus"), { parameters: [id()] }),
    },
    "/v1/runtime": {
      get: {
        responses: {
          "200": response(ref("Runtime")),
          "401": error,
          "429": error,
          "503": error,
        },
      },
    },
    "/v1/settlements": {
      get: get(list("Settlement"), { parameters: pagination }),
    },
    "/v1/events": { get: get(list("Event"), { parameters: pagination }) },
    "/v1/outbox": { get: get(list("Outbox"), { parameters: pagination }) },
    "/v1/outbox/{eventId}/replay": {
      post: {
        parameters: [id("eventId")],
        responses: {
          "202": response(ref("Replay")),
          "401": error,
          "404": error,
          "409": error,
          "429": error,
        },
        description:
          "Replay a dead-lettered event after repairing its receiver. Already delivered and pending events cannot be replayed here.",
      },
    },
    "/v1/descriptors/verify": {
      post: {
        requestBody: body("Descriptor"),
        responses: {
          "200": response(ref("Verification")),
          "400": error,
          "401": error,
          "415": error,
        },
        description:
          "Verify against this daemon's configured merchant signer. Does not prove settlement or replace expiry/amount checks.",
      },
    },
    "/v1/metrics": {
      get: {
        responses: {
          "200": {
            description: "Metadata-free Prometheus text",
            content: { "text/plain": { schema: { type: "string" } } },
          },
          "401": error,
          "429": error,
        },
      },
    },
    "/v1/openapi.json": { get: get({ type: "object" }) },
  },
  webhooks: {
    paymentEvent: {
      post: {
        description:
          "Outbound event to the configured merchant URL. HMAC-SHA256 covers timestamp.keyId.eventId.rawBody. Verify freshness and raw bytes, validate schema and durably deduplicate eventId before returning 2xx.",
        security: [],
        parameters: [
          "PPOps-Event-Id",
          "PPOps-Timestamp",
          "PPOps-Key-Id",
          "PPOps-Signature",
        ].map((name) => ({
          name,
          in: "header",
          required: true,
          schema: { type: "string" },
        })),
        requestBody: body("Event"),
        responses: {
          "200": {
            description:
              "Accepted or valid duplicate. Other non-2xx responses trigger bounded retries.",
          },
        },
      },
    },
  },
  components: {
    securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } },
    schemas: Object.fromEntries(
      Object.entries(schemas).map(([name, schema]) => {
        const { $schema: _dialect, ...value } = z.toJSONSchema(schema);
        return [name, value];
      }),
    ),
  },
};
