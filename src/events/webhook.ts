import { createHmac } from "node:crypto";

import type { PPOpsConfig } from "../config.js";
import type { PPOpsDatabase } from "../db/database.js";

export const webhookSignature = (
  hmacKeyHex: string,
  timestamp: number,
  eventId: string,
  payloadJson: string,
): string =>
  `v1=${createHmac("sha256", Buffer.from(hmacKeyHex, "hex"))
    .update(`${timestamp}.${eventId}.${payloadJson}`)
    .digest("hex")}`;

export class WebhookDeliveryService {
  constructor(
    private readonly database: PPOpsDatabase,
    private readonly config: NonNullable<PPOpsConfig["webhook"]>,
    private readonly hmacKeyHex: string,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {}

  async deliverPending(now = Math.floor(Date.now() / 1_000)): Promise<{
    attempted: number;
    delivered: number;
    failed: number;
    deadLettered: number;
  }> {
    const result = { attempted: 0, delivered: 0, failed: 0, deadLettered: 0 };
    for (const record of this.database.listPendingEvents(now)) {
      result.attempted += 1;
      try {
        const timestamp = Math.floor(Date.now() / 1_000);
        const response = await this.fetchImplementation(this.config.url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "ppops-event-id": record.event.eventId,
            "ppops-timestamp": timestamp.toString(),
            "ppops-signature": webhookSignature(
              this.hmacKeyHex,
              timestamp,
              record.event.eventId,
              record.payloadJson,
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
        const message = error instanceof Error ? error.message : "Webhook delivery failed";
        if (record.attempts + 1 >= this.config.maxAttempts) {
          this.database.markEventDeadLettered(record.event.eventId, now, message);
          result.deadLettered += 1;
        } else {
          const exponential = this.config.baseRetryMs * 2 ** record.attempts;
          const retrySeconds = Math.max(
            1,
            Math.ceil(Math.min(exponential, this.config.maxRetryMs) / 1_000),
          );
          this.database.markEventFailed(record.event.eventId, now + retrySeconds, message);
          result.failed += 1;
        }
      }
    }
    return result;
  }
}
