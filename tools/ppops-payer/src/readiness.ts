import type { PaymentRequest } from "./request.js";

export type PayerReadiness =
  | "READY"
  | "INSUFFICIENT_PRIVATE_BALANCE"
  | "PRIVATE_BALANCE_PENDING"
  | "SYNCING"
  | "RAIL_UNAVAILABLE"
  | "REQUEST_EXPIRED"
  | "REQUEST_NOT_PAYABLE";
export const readinessMessages: Record<PayerReadiness, string> = {
  READY:
    "Private balance ready for the amount and fee budget. Prepare the payment to obtain a current fee quote; review before approving.",
  INSUFFICIENT_PRIVATE_BALANCE:
    "Not enough private USDC is available. Review your available and pending balance before preparing more funds.",
  PRIVATE_BALANCE_PENDING:
    "Your private balance is being prepared. Privacy checks are pending. Check again later; no reliable completion time is available.",
  SYNCING:
    "Your wallet is updating its payment history. Check again when synchronization completes.",
  RAIL_UNAVAILABLE:
    "Payment readiness could not be established. Check the wallet and merchant connection, then try again. Do not send yet.",
  REQUEST_EXPIRED:
    "This payment request has expired. Ask the merchant for a new link.",
  REQUEST_NOT_PAYABLE:
    "This request already has a payment or needs merchant review. Do not send again; check its current status.",
};

export function payerReadiness(input: {
  request: PaymentRequest;
  feeBudgetAtomic: string;
  balances?: Record<string, string>;
  syncing?: boolean;
  railAvailable?: boolean;
  nowSeconds?: number;
}) {
  if (!/^(0|[1-9][0-9]*)$/.test(input.feeBudgetAtomic))
    throw new Error("Invalid fee budget");
  const required =
    BigInt(input.request.amountAtomic) + BigInt(input.feeBudgetAtomic);
  let spendable = 0n,
    pending = 0n,
    validBalances = !!input.balances;
  try {
    const amount = (key: string) => {
      const value = input.balances?.[key] ?? "0";
      if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error("Invalid balance");
      return BigInt(value);
    };
    spendable = amount("Spendable");
    pending = [
      "ShieldPending",
      "MissingInternalPOI",
      "MissingExternalPOI",
      "ProofSubmitted",
    ].reduce((sum, key) => sum + amount(key), 0n);
  } catch {
    validBalances = false;
  }
  let state: PayerReadiness;
  if (
    input.request.status === "PAID" ||
    input.request.status === "PAID_LATE" ||
    BigInt(input.request.receivedAmountAtomic) > 0n ||
    BigInt(input.request.pendingAmountAtomic) > 0n
  )
    state = "REQUEST_NOT_PAYABLE";
  else if (
    input.request.expiresAt <=
      (input.nowSeconds ?? Math.floor(Date.now() / 1000)) ||
    input.request.status === "EXPIRED"
  )
    state = "REQUEST_EXPIRED";
  else if (
    input.request.status !== "OPEN" ||
    (input.request.paymentStage !== undefined &&
      input.request.paymentStage !== "AWAITING_PAYMENT")
  )
    state = "REQUEST_NOT_PAYABLE";
  else if (
    input.railAvailable === false ||
    input.request.reconciliationReady === false
  )
    state = "RAIL_UNAVAILABLE";
  else if (input.syncing) state = "SYNCING";
  else if (!validBalances) state = "RAIL_UNAVAILABLE";
  else if (spendable >= required) state = "READY";
  else if (spendable + pending >= required) state = "PRIVATE_BALANCE_PENDING";
  else state = "INSUFFICIENT_PRIVATE_BALANCE";
  return {
    state,
    message: readinessMessages[state],
    amountAtomic: input.request.amountAtomic,
    feeBudgetAtomic: input.feeBudgetAtomic,
    feeBasis: "operator-budget-not-a-quote" as const,
    requiredAmountAtomic: required.toString(),
    availableAmountAtomic: validBalances ? spendable.toString() : null,
    preparingAmountAtomic: validBalances ? pending.toString() : null,
    shortfallAtomic: validBalances
      ? (required > spendable ? required - spendable : 0n).toString()
      : null,
    estimatedReadyAt: null,
    paymentSubmitted: false as const,
  };
}
