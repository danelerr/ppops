import type { PaymentIntentView, SettlementRecord } from "../domain.js";

export type PaymentStage =
  | "AWAITING_PAYMENT"
  | "PAYMENT_DETECTED"
  | "PRIVACY_CHECKS_PENDING"
  | "PAYMENT_COMPLETE"
  | "PAYMENT_REVERTED";

// A presentation projection, not a second acceptance engine. Only reconciliation
// can credit FINALIZED + SPENDABLE + MATCHED value and derive PAID/PAID_LATE.
export function paymentStage(
  intent: PaymentIntentView,
  settlements: SettlementRecord[],
): PaymentStage {
  if (intent.status === "PAID" || intent.status === "PAID_LATE")
    return "PAYMENT_COMPLETE";
  const matched = settlements.filter(
    (item) => item.matchStatus === "MATCHED" && item.intentId === intent.id,
  );
  const finalizedPending = matched
    .filter(
      (item) =>
        item.chainStatus === "FINALIZED" && item.poiStatus !== "SPENDABLE",
    )
    .reduce((sum, item) => sum + BigInt(item.amountAtomic), 0n);
  if (
    finalizedPending > 0n &&
    finalizedPending + BigInt(intent.receivedAmountAtomic) >=
      BigInt(intent.expectedAmountAtomic)
  )
    return "PRIVACY_CHECKS_PENDING";
  if (BigInt(intent.pendingAmountAtomic) > 0n) return "PAYMENT_DETECTED";
  if (matched.some((item) => item.chainStatus === "REVERTED"))
    return "PAYMENT_REVERTED";
  return "AWAITING_PAYMENT";
}
