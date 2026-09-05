import { z } from "zod";

export const AtomicAmountSchema = z.string().regex(/^(?:0|[1-9][0-9]*)$/);
export const IntentStatusSchema = z.enum([
  "OPEN",
  "PARTIAL",
  "PAID",
  "EXPIRED",
  "PAID_LATE",
]);
const Timestamp = z.number().int().nonnegative();
export const DescriptorHttpSchema = z.object({
  version: z.literal(1),
  chainId: z.number().int().positive(),
  rail: z.literal("railgun"),
  tokenAddress: z.string(),
  decimals: z.number().int().min(0).max(255),
  amountAtomic: AtomicAmountSchema,
  recipient0zk: z.string(),
  reference: z.string(),
  expiresAt: Timestamp,
  nonce: z.string(),
  merchantSigner: z.string(),
  signature: z.string(),
});
export const IntentHttpSchema = z.object({
  id: z.string(),
  externalReference: z.string(),
  chainId: z.number().int(),
  tokenAddress: z.string(),
  tokenSymbol: z.string(),
  decimals: z.number().int(),
  expectedAmountAtomic: AtomicAmountSchema,
  receivedAmountAtomic: AtomicAmountSchema,
  pendingAmountAtomic: AtomicAmountSchema,
  overpaymentAmountAtomic: AtomicAmountSchema,
  status: IntentStatusSchema,
  expiresAt: Timestamp,
  createdAt: Timestamp,
  revision: z.number().int(),
  checkoutPath: z.string(),
  payment: z.object({
    rail: z.literal("railgun"),
    recipient: z.string(),
    memo: z.string(),
    descriptor: DescriptorHttpSchema,
  }),
});
export const IntentProjectionHttpSchema = IntentHttpSchema.pick({
  id: true,
  status: true,
  expectedAmountAtomic: true,
  receivedAmountAtomic: true,
  pendingAmountAtomic: true,
  overpaymentAmountAtomic: true,
  expiresAt: true,
  revision: true,
});
export const CheckoutHttpSchema = z.object({
  id: z.string(),
  chainId: z.number().int(),
  tokenAddress: z.string(),
  tokenSymbol: z.string(),
  decimals: z.number().int(),
  amountAtomic: AtomicAmountSchema,
  amountFormatted: z.string(),
  receivedAmountAtomic: AtomicAmountSchema,
  pendingAmountAtomic: AtomicAmountSchema,
  status: IntentStatusSchema,
  expiresAt: Timestamp,
  rail: z.literal("railgun"),
  recipient: z.string(),
  memo: z.string(),
  descriptor: DescriptorHttpSchema,
  expectedMerchantSigner: z.string(),
  reconciliationReady: z.boolean(),
  simulated: z.literal(true).optional(),
});
export const SettlementHttpSchema = z.object({
  uniqueSettlementId: z.string(),
  chainId: z.number().int(),
  txidVersion: z.string(),
  tree: z.number().int(),
  position: z.number().int(),
  transactionHash: z.string(),
  railgunTxid: z.string().optional(),
  tokenAddress: z.string(),
  amountAtomic: AtomicAmountSchema,
  blockNumber: z.number().int(),
  blockTimestamp: Timestamp,
  balanceBucket: z.string(),
  rawPPOIStatuses: z.record(z.string(), z.string()),
  chainStatus: z.enum(["OBSERVED", "CONFIRMED", "FINALIZED", "REVERTED"]),
  poiStatus: z.enum(["UNKNOWN", "PENDING", "SPENDABLE", "BLOCKED"]),
  matchStatus: z.enum(["UNMATCHED", "MATCHED", "CONFLICT"]),
  reference: z.string().optional(),
  intentId: z.string().optional(),
  firstSeenAt: Timestamp,
  lastSeenAt: Timestamp,
  eligibleAt: Timestamp.optional(),
});
export const OutboxHttpSchema = z.object({
  eventId: z.string(),
  eventType: z.string(),
  attempts: z.number().int(),
  nextAttemptAt: Timestamp,
  deliveredAt: Timestamp.optional(),
  deadLetteredAt: Timestamp.optional(),
  lastError: z.string().optional(),
});
export const CreateIntentSchema = z
  .object({
    externalReference: z.string().min(1).max(512),
    amountAtomic: z.string().regex(/^[1-9][0-9]*$/),
    expiresAt: z.number().int().positive(),
  })
  .strict();
export const EventSchema = z
  .object({
    schemaVersion: z.literal(1),
    eventId: z.string().regex(/^evt_[0-9a-f]{32}$/),
    type: z.enum([
      "settlement.observed",
      "payment.partial",
      "payment.confirmed",
      "payment.expired",
      "payment.reverted",
    ]),
    occurredAt: z.number().int().nonnegative(),
    intentId: z.string().regex(/^pi_[0-9a-f]{32}$/),
    settlementId: z.string().min(1).max(512).optional(),
    intentStatus: IntentStatusSchema,
    receivedAmountAtomic: AtomicAmountSchema,
    expectedAmountAtomic: AtomicAmountSchema,
    overpaymentAmountAtomic: AtomicAmountSchema,
  })
  .strict();

export type CreateIntentRequest = z.infer<typeof CreateIntentSchema>;
export type PaymentEvent = z.infer<typeof EventSchema>;

const fieldHints: Record<keyof CreateIntentRequest, string> = {
  externalReference:
    "Use a string containing 1–512 characters; keep your order ID on the merchant backend.",
  amountAtomic:
    "Use a positive integer string. For USDC, 1000000 atomic units equal 1 USDC.",
  expiresAt:
    "Use a future Unix timestamp in seconds: Math.floor(Date.now() / 1000) + 3600.",
};

export const requestIssues = (error: z.ZodError) =>
  error.issues.map((issue) => {
    const field = issue.path[0];
    return typeof field === "string" && Object.hasOwn(fieldHints, field)
      ? { field, hint: fieldHints[field as keyof CreateIntentRequest] }
      : {
          field: "body",
          hint: "Send a JSON object with only externalReference, amountAtomic and expiresAt.",
        };
  });
