import { createHmac, timingSafeEqual } from "node:crypto";

import type { PPOpsConfig } from "../config.js";
import type { PPOpsDatabase } from "../db/database.js";

type WebhookFailureCode =
  | "TIMEOUT"
  | "HTTP_4XX"
  | "HTTP_5XX"
  | "HTTP_OTHER"
  | "NETWORK"
  | "DELIVERY_FAILED";

export const classifyWebhookFailure = (error: unknown): WebhookFailureCode => {
  if (!(error instanceof Error)) return "DELIVERY_FAILED";
  if (error.name === "AbortError" || error.name === "TimeoutError") return "TIMEOUT";
  const status = /Webhook returned HTTP ([0-9]{3})/.exec(error.message)?.[1];
  if (status) {
    if (status.startsWith("4")) return "HTTP_4XX";
    if (status.startsWith("5")) return "HTTP_5XX";
    return "HTTP_OTHER";
  }
  const code = String((error as NodeJS.ErrnoException).code ?? "").toUpperCase();
  if (
    ["ECONNREFUSED", "ECONNRESET", "ENETUNREACH", "ENOTFOUND", "EAI_AGAIN"].includes(
      code,
    ) ||
    error instanceof TypeError
  ) {
    return "NETWORK";
  }
  return "DELIVERY_FAILED";
};

export const webhookSignature = (
  hmacKeyHex: string,
  timestamp: number,
  eventId: string,
  payloadJson: string,
  keyId = "v1",
): string =>
  `v1=${createHmac("sha256", Buffer.from(hmacKeyHex, "hex"))
    .update(`${timestamp}.${keyId}.${eventId}.${payloadJson}`)
    .digest("hex")}`;

export const verifyWebhookSignature = (args: {
  hmacKeyHex: string;
  timestamp: number;
  eventId: string;
  keyId: string;
  payloadJson: string;
  signature: string;
  now?: number;
  toleranceSeconds?: number;
}): boolean => {
  const now = args.now ?? Math.floor(Date.now() / 1_000);
  const toleranceSeconds = args.toleranceSeconds ?? 300;
  if (
    !/^[0-9a-f]{64}$/i.test(args.hmacKeyHex) ||
    !Number.isSafeInteger(args.timestamp) ||
    args.timestamp < 0 ||
    !Number.isSafeInteger(toleranceSeconds) ||
    toleranceSeconds < 0 ||
    Math.abs(now - args.timestamp) > toleranceSeconds ||
    !/^evt_[0-9a-f]{32}$/.test(args.eventId) ||
    !/^[A-Za-z0-9._-]{1,64}$/.test(args.keyId) ||
    !/^v1=[0-9a-f]{64}$/.test(args.signature)
  ) {
    return false;
  }
  const expected = Buffer.from(
    webhookSignature(
      args.hmacKeyHex,
      args.timestamp,
      args.eventId,
      args.payloadJson,
      args.keyId,
    ),
    "utf8",
  );
  const received = Buffer.from(args.signature, "utf8");
  return expected.length === received.length && timingSafeEqual(expected, received);
};

export type WebhookDeliveryResult = {
  attempted: number;
  delivered: number;
  failed: number;
  deadLettered: number;
};

export class WebhookDeliveryService {
  private deliveryTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly database: PPOpsDatabase,
    private readonly config: NonNullable<PPOpsConfig["webhook"]>,
    private readonly hmacKeyHex: string,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {}

  deliverPending(
    now = Math.floor(Date.now() / 1_000),
  ): Promise<WebhookDeliveryResult> {
    const operation = this.deliveryTail.then(() => this.deliverPendingExclusive(now));
    this.deliveryTail = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  private async deliverPendingExclusive(now: number): Promise<WebhookDeliveryResult> {
    const result = { attempted: 0, delivered: 0, failed: 0, deadLettered: 0 };
    for (const record of this.database.listPendingEvents(now)) {
      result.attempted += 1;
      try {
        const timestamp = Math.floor(Date.now() / 1_000);
        const keyId = this.config.keyId ?? "v1";
        const response = await this.fetchImplementation(this.config.url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "ppops-event-id": record.event.eventId,
            "ppops-timestamp": timestamp.toString(),
            "ppops-key-id": keyId,
            "ppops-signature": webhookSignature(
              this.hmacKeyHex,
              timestamp,
              record.event.eventId,
              record.payloadJson,
              keyId,
            ),
          },
          body: record.payloadJson,
          signal: AbortSignal.timeout(this.config.timeoutMs),
          redirect: "error",
        });
        await response.body?.cancel();
        if (!response.ok) throw new Error(`Webhook returned HTTP ${response.status}`);
        this.database.markEventDelivered(record.event.eventId, now);
        result.delivered += 1;
      } catch (error) {
        const failureCode = classifyWebhookFailure(error);
        if (record.attempts + 1 >= this.config.maxAttempts) {
          this.database.markEventDeadLettered(record.event.eventId, now, failureCode);
          result.deadLettered += 1;
        } else {
          const exponential = this.config.baseRetryMs * 2 ** record.attempts;
          const retrySeconds = Math.max(
            1,
            Math.ceil(Math.min(exponential, this.config.maxRetryMs) / 1_000),
          );
          this.database.markEventFailed(
            record.event.eventId,
            now + retrySeconds,
            failureCode,
          );
          result.failed += 1;
        }
      }
    }
    return result;
  }
}
