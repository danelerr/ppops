import type {
  IntentProjection,
  IntentStatus,
  PaymentIntentRecord,
  SettlementRecord,
} from "../domain.js";

const isCreditable = (settlement: SettlementRecord): boolean =>
  settlement.matchStatus === "MATCHED" &&
  settlement.chainStatus === "FINALIZED" &&
  settlement.poiStatus === "SPENDABLE";

const isPending = (settlement: SettlementRecord): boolean =>
  settlement.matchStatus === "MATCHED" &&
  settlement.chainStatus !== "REVERTED" &&
  !isCreditable(settlement);

const addAmounts = (settlements: SettlementRecord[]): bigint =>
  settlements.reduce((sum, settlement) => sum + BigInt(settlement.amountAtomic), 0n);

const statusFor = (
  intent: PaymentIntentRecord,
  creditable: SettlementRecord[],
  received: bigint,
  now: number,
): IntentStatus => {
  const expected = BigInt(intent.expectedAmountAtomic);
  if (received >= expected) {
    let cumulative = 0n;
    const ordered = [...creditable].sort(
      (left, right) =>
        left.blockNumber - right.blockNumber ||
        left.tree - right.tree ||
        left.position - right.position,
    );
    let crossingTimestamp = now;
    for (const settlement of ordered) {
      cumulative += BigInt(settlement.amountAtomic);
      if (cumulative >= expected) {
        crossingTimestamp = settlement.blockTimestamp;
        break;
      }
    }
    return crossingTimestamp > intent.expiresAt ? "PAID_LATE" : "PAID";
  }
  if (received > 0n) return "PARTIAL";
  return now >= intent.expiresAt ? "EXPIRED" : "OPEN";
};

export const deriveProjection = (
  intent: PaymentIntentRecord,
  settlements: SettlementRecord[],
  previous: IntentProjection,
  now: number,
): IntentProjection => {
  const creditable = settlements.filter(isCreditable);
  const pending = settlements.filter(isPending);
  const received = addAmounts(creditable);
  const pendingAmount = addAmounts(pending);
  const expected = BigInt(intent.expectedAmountAtomic);
  const next = {
    intentId: intent.id,
    status: statusFor(intent, creditable, received, now),
    receivedAmountAtomic: received.toString(),
    pendingAmountAtomic: pendingAmount.toString(),
    overpaymentAmountAtomic: received > expected ? (received - expected).toString() : "0",
    revision: previous.revision,
    updatedAt: previous.updatedAt,
  } satisfies IntentProjection;
  const changed =
    next.status !== previous.status ||
    next.receivedAmountAtomic !== previous.receivedAmountAtomic ||
    next.pendingAmountAtomic !== previous.pendingAmountAtomic ||
    next.overpaymentAmountAtomic !== previous.overpaymentAmountAtomic;
  return changed
    ? { ...next, revision: previous.revision + 1, updatedAt: now }
    : previous;
};
