import { createHash } from "node:crypto";

import type {
  IntentProjection,
  PaymentIntentRecord,
  PPOpsEvent,
  PPOpsEventType,
} from "../domain.js";

export const eventIdFor = (dedupeKey: string): string =>
  `evt_${createHash("sha256").update(dedupeKey).digest("hex").slice(0, 32)}`;

export const createEvent = (args: {
  type: PPOpsEventType;
  intent: PaymentIntentRecord;
  projection: IntentProjection;
  occurredAt: number;
  settlementId?: string;
  dedupeKey: string;
}): PPOpsEvent => ({
  schemaVersion: 1,
  eventId: eventIdFor(args.dedupeKey),
  type: args.type,
  occurredAt: args.occurredAt,
  intentId: args.intent.id,
  ...(args.settlementId ? { settlementId: args.settlementId } : {}),
  intentStatus: args.projection.status,
  receivedAmountAtomic: args.projection.receivedAmountAtomic,
  expectedAmountAtomic: args.intent.expectedAmountAtomic,
  overpaymentAmountAtomic: args.projection.overpaymentAmountAtomic,
});
