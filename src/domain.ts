export const RAIL = "railgun" as const;

export type Rail = typeof RAIL;
export type ChainStatus =
  | "OBSERVED"
  | "CONFIRMED"
  | "FINALIZED"
  | "REVERTED";
export type POIStatus = "UNKNOWN" | "PENDING" | "SPENDABLE" | "BLOCKED";
export type MatchStatus = "UNMATCHED" | "MATCHED" | "CONFLICT";
export type IntentStatus = "OPEN" | "PARTIAL" | "PAID" | "EXPIRED" | "PAID_LATE";

export type PaymentDescriptorPayloadV1 = {
  version: 1;
  chainId: number;
  rail: Rail;
  tokenAddress: string;
  decimals: number;
  amountAtomic: string;
  recipient0zk: string;
  reference: string;
  expiresAt: number;
  nonce: string;
  merchantSigner: string;
};

export type SignedPaymentDescriptorV1 = PaymentDescriptorPayloadV1 & {
  signature: string;
};

export type PaymentIntentRecord = {
  id: string;
  externalReference: string;
  reference: string;
  chainId: number;
  tokenAddress: string;
  tokenSymbol: string;
  decimals: number;
  expectedAmountAtomic: string;
  recipient0zk: string;
  expiresAt: number;
  descriptor: SignedPaymentDescriptorV1;
  createdAt: number;
};

export type IntentProjection = {
  intentId: string;
  status: IntentStatus;
  receivedAmountAtomic: string;
  pendingAmountAtomic: string;
  overpaymentAmountAtomic: string;
  revision: number;
  updatedAt: number;
};

export type PaymentIntentView = PaymentIntentRecord & IntentProjection;

export type NormalizedSettlement = {
  uniqueSettlementId: string;
  chainId: number;
  txidVersion: string;
  tree: number;
  position: number;
  transactionHash: string;
  railgunTxid?: string;
  tokenAddress: string;
  amountAtomic: string;
  blockNumber: number;
  blockTimestamp: number;
  balanceBucket: string;
  rawPPOIStatuses: Record<string, string>;
  chainStatus: ChainStatus;
  poiStatus: POIStatus;
  reference?: string;
};

export type SettlementRecord = NormalizedSettlement & {
  matchStatus: MatchStatus;
  intentId?: string;
  firstSeenAt: number;
  lastSeenAt: number;
  eligibleAt?: number;
};

export type PPOpsEventType =
  | "settlement.observed"
  | "payment.partial"
  | "payment.confirmed"
  | "payment.expired"
  | "payment.reverted";

export type PPOpsEvent = {
  schemaVersion: 1;
  eventId: string;
  type: PPOpsEventType;
  occurredAt: number;
  intentId: string;
  settlementId?: string;
  intentStatus: IntentStatus;
  receivedAmountAtomic: string;
  expectedAmountAtomic: string;
  overpaymentAmountAtomic: string;
};

export const isPositiveAtomicAmount = (value: string): boolean =>
  /^(?:0|[1-9][0-9]*)$/.test(value) && BigInt(value) > 0n;

export const normalizeHex = (value: string): string => value.toLowerCase();

export const parsePPOpsReference = (memoText: string | undefined): string | undefined => {
  if (!memoText) return undefined;
  const match = /^ppops:v1:(0x[0-9a-f]{64})$/i.exec(memoText);
  return match?.[1]?.toLowerCase();
};

export const memoForReference = (reference: string): string => {
  if (!/^0x[0-9a-f]{64}$/i.test(reference)) {
    throw new Error("PPOps reference must be a 32-byte hex value");
  }
  return `ppops:v1:${reference.toLowerCase()}`;
};
