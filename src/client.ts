/** Merchant HTTP helpers. This module never imports the RAILGUN engine. */
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  EventSchema,
  type CreateIntentRequest,
  type PaymentEvent,
} from "./api/contracts.js";
import type { IntentStatus, SignedPaymentDescriptorV1 } from "./domain.js";

export type { CreateIntentRequest, PaymentEvent };
export type Intent = {
  id: string;
  externalReference: string;
  chainId: number;
  tokenAddress: string;
  tokenSymbol: string;
  decimals: number;
  expectedAmountAtomic: string;
  receivedAmountAtomic: string;
  pendingAmountAtomic: string;
  overpaymentAmountAtomic: string;
  status: IntentStatus;
  expiresAt: number;
  createdAt: number;
  revision: number;
  checkoutPath: string;
  payment: {
    rail: "railgun";
    recipient: string;
    memo: string;
    descriptor: SignedPaymentDescriptorV1;
  };
};

export class PPOpsApiError extends Error {
  constructor(
    readonly status: number,
    readonly details: unknown,
  ) {
    super(
      `PPOps returned HTTP ${status}. Retry a timed-out create with the same idempotency key and body.`,
    );
    this.name = "PPOpsApiError";
  }
}

export class PPOpsClient {
  private readonly origin: string;
  constructor(
    private readonly options: {
      baseUrl: string;
      apiToken: string;
      timeoutMs?: number;
      fetch?: typeof fetch;
    },
  ) {
    const url = new URL(options.baseUrl);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    )
      throw new Error(
        "Use a PPOps origin without credentials, path, query or fragment.",
      );
    if (
      url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      )
    )
      throw new Error("Use HTTPS or local loopback HTTP.");
    if (!options.apiToken) throw new Error("An API token is required.");
    this.origin = url.origin;
  }

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (
      !path.startsWith("/v1/") ||
      path.includes("\\") ||
      new URL(path, this.origin).origin !== this.origin
    )
      throw new Error("Use a /v1/ API path.");
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${this.options.apiToken}`);
    const response = await (this.options.fetch ?? fetch)(this.origin + path, {
      ...init,
      headers,
      redirect: "error",
      signal:
        init.signal ?? AbortSignal.timeout(this.options.timeoutMs ?? 20_000),
    });
    const body: unknown = await response.json();
    if (!response.ok) throw new PPOpsApiError(response.status, body);
    return body as T;
  }

  createIntent(
    body: CreateIntentRequest,
    idempotencyKey: string,
  ): Promise<Intent> {
    return this.request("/v1/intents", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      body: JSON.stringify(body),
    });
  }
  getIntent(id: string): Promise<Intent> {
    return this.request(`/v1/intents/${encodeURIComponent(id)}`);
  }
  listIntents(
    limit = 100,
    offset = 0,
  ): Promise<{ items: Intent[]; limit: number; offset: number }> {
    return this.request(`/v1/intents?limit=${limit}&offset=${offset}`);
  }
}

/** Parse human USDC without floating-point arithmetic. */
export const usdcAtomic = (amount: string): string => {
  if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,6})?$/.test(amount))
    throw new Error(
      "Use a decimal USDC string with at most 6 fractional digits.",
    );
  const [whole = "0", fraction = ""] = amount.split(".");
  const atomic = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
  if (atomic <= 0n) throw new Error("The amount must be positive.");
  return atomic.toString();
};

/** Verify first; durably deduplicate eventId in the same transaction as fulfillment. */
export const verifyPaymentWebhook = (args: {
  rawBody: Uint8Array;
  headers: Headers;
  keys: Readonly<Record<string, string>>;
  nowSeconds?: number;
}): PaymentEvent => {
  const fail = (): never => {
    throw new Error(
      "Invalid PPOps webhook. Check raw bytes, key ID, timestamp and event schema.",
    );
  };
  if (args.rawBody.byteLength > 65_536) return fail();
  const timestamp = args.headers.get("ppops-timestamp") ?? "";
  const eventId = args.headers.get("ppops-event-id") ?? "";
  const keyId = args.headers.get("ppops-key-id") ?? "";
  const signature = args.headers.get("ppops-signature") ?? "";
  const key = Object.hasOwn(args.keys, keyId) ? args.keys[keyId] : undefined;
  if (
    !/^[0-9]{1,12}$/.test(timestamp) ||
    !/^evt_[0-9a-f]{32}$/.test(eventId) ||
    !/^[A-Za-z0-9._-]{1,64}$/.test(keyId) ||
    !key ||
    !/^[0-9a-f]{64}$/i.test(key)
  )
    return fail();
  if (
    Math.abs(
      (args.nowSeconds ?? Math.floor(Date.now() / 1000)) - Number(timestamp),
    ) > 300
  )
    return fail();
  const expected = Buffer.from(
    "v1=" +
      createHmac("sha256", Buffer.from(key, "hex"))
        .update(`${timestamp}.${keyId}.${eventId}.`)
        .update(args.rawBody)
        .digest("hex"),
  );
  const received = Buffer.from(signature);
  if (
    received.length !== expected.length ||
    !timingSafeEqual(expected, received)
  )
    return fail();
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(args.rawBody).toString("utf8"));
  } catch {
    return fail();
  }
  const parsed = EventSchema.safeParse(payload);
  if (!parsed.success || parsed.data.eventId !== eventId) return fail();
  return parsed.data;
};
