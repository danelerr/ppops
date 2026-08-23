import type { PPOpsDatabase } from "../db/database.js";
import type {
  IntentProjection,
  NormalizedSettlement,
  PaymentIntentRecord,
  PPOpsEventType,
  SettlementRecord,
} from "../domain.js";
import { createEvent } from "../events/event-factory.js";
import { deriveProjection } from "./projection.js";

const immutableSettlementFields = [
  "chainId",
  "txidVersion",
  "tree",
  "position",
  "transactionHash",
  "tokenAddress",
  "amountAtomic",
  "reference",
] as const;

const paid = (projection: IntentProjection): boolean =>
  projection.status === "PAID" || projection.status === "PAID_LATE";

const transitionEventType = (
  previous: IntentProjection,
  next: IntentProjection,
): PPOpsEventType | undefined => {
  if (paid(previous) && !paid(next)) return "payment.reverted";
  if (!paid(previous) && paid(next)) return "payment.confirmed";
  if (next.status === "PARTIAL" && next.receivedAmountAtomic !== previous.receivedAmountAtomic) {
    return "payment.partial";
  }
  if (previous.status !== "EXPIRED" && next.status === "EXPIRED") {
    return "payment.expired";
  }
  return undefined;
};

export class ReconciliationService {
  constructor(private readonly database: PPOpsDatabase) {}

  reconcile(candidate: NormalizedSettlement, now = Math.floor(Date.now() / 1_000)):
  SettlementRecord {
    return this.database.transaction(() => {
      const existing = this.database.getSettlement(candidate.uniqueSettlementId);
      if (existing) this.assertImmutableIdentity(existing, candidate);

      const intent = candidate.reference
        ? this.database.findIntentByReference(candidate.reference)
        : undefined;
      const matchesRail =
        intent !== undefined &&
        intent.chainId === candidate.chainId &&
        intent.tokenAddress.toLowerCase() === candidate.tokenAddress.toLowerCase();
      const matchStatus = intent ? (matchesRail ? "MATCHED" : "CONFLICT") : "UNMATCHED";
      const poiStatus =
        candidate.balanceBucket === "Spent" &&
        candidate.poiStatus === "UNKNOWN" &&
        existing?.poiStatus === "SPENDABLE"
          ? "SPENDABLE"
          : candidate.poiStatus;
      const eligible =
        matchStatus === "MATCHED" &&
        candidate.chainStatus === "FINALIZED" &&
        poiStatus === "SPENDABLE";
      const settlement = this.database.upsertSettlement({
        ...candidate,
        poiStatus,
        matchStatus,
        ...(intent && matchesRail ? { intentId: intent.id } : {}),
        firstSeenAt: existing?.firstSeenAt ?? now,
        lastSeenAt: now,
        ...(eligible ? { eligibleAt: existing?.eligibleAt ?? now } : {}),
      });

      if (!intent || !matchesRail) return settlement;
      if (!existing) {
        this.persistEvent(
          "settlement.observed",
          intent,
          this.requireProjection(intent.id),
          now,
          settlement.uniqueSettlementId,
          `settlement.observed:${settlement.uniqueSettlementId}`,
        );
      }
      this.rebuildProjection(intent, now, settlement.uniqueSettlementId);
      return settlement;
    });
  }

  refreshExpirations(now = Math.floor(Date.now() / 1_000)): number {
    return this.database.transaction(() => {
      let changed = 0;
      for (const intent of this.database.listIntents(100_000, 0)) {
        const before = this.requireProjection(intent.id);
        const after = this.rebuildProjection(intent, now);
        if (after.revision !== before.revision) changed += 1;
      }
      return changed;
    });
  }

  private rebuildProjection(
    intent: PaymentIntentRecord,
    now: number,
    settlementId?: string,
  ): IntentProjection {
    const previous = this.requireProjection(intent.id);
    const next = deriveProjection(
      intent,
      this.database.listSettlementsForIntent(intent.id),
      previous,
      now,
    );
    if (next.revision === previous.revision) return previous;
    this.database.updateProjection(next);
    const type = transitionEventType(previous, next);
    if (type) {
      const dedupeKey = `${type}:${intent.id}:${next.revision}`;
      this.persistEvent(type, intent, next, now, settlementId, dedupeKey);
    }
    return next;
  }

  private persistEvent(
    type: PPOpsEventType,
    intent: PaymentIntentRecord,
    projection: IntentProjection,
    occurredAt: number,
    settlementId: string | undefined,
    dedupeKey: string,
  ): void {
    this.database.insertEvent(
      createEvent({
        type,
        intent,
        projection,
        occurredAt,
        ...(settlementId ? { settlementId } : {}),
        dedupeKey,
      }),
      dedupeKey,
    );
  }

  private requireProjection(intentId: string): IntentProjection {
    const projection = this.database.getProjection(intentId);
    if (!projection) throw new Error(`Missing projection for payment intent ${intentId}`);
    return projection;
  }

  private assertImmutableIdentity(
    stored: SettlementRecord,
    candidate: NormalizedSettlement,
  ): void {
    for (const field of immutableSettlementFields) {
      const left = stored[field];
      const right = candidate[field];
      if (left !== right) {
        throw new Error(
          `Settlement identity collision: ${field} changed for ${candidate.uniqueSettlementId}`,
        );
      }
    }
  }
}
