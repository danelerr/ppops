import { createHmac } from "node:crypto";
import { isIP } from "node:net";

import { getAddress, isAddress, verifyMessage, Wallet } from "ethers";
import { z } from "zod";

import {
  ARBITRUM_MAINNET_CHAIN_ID,
  ARBITRUM_NATIVE_USDC,
} from "../config.js";
import { memoForReference } from "../domain.js";
import { webhookSignature } from "../events/webhook.js";
import {
  SignedPaymentDescriptorSchema,
  verifySignedDescriptor,
} from "../security/descriptor.js";
import { readResponseTextLimited } from "../security/http.js";

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const PAGE_SIZE = 250;
const MAX_PAGES = 40;
const AtomicAmountSchema = z.string().regex(/^(?:0|[1-9][0-9]*)$/);
const PositiveAtomicAmountSchema = z.string().regex(/^[1-9][0-9]*$/);
const FingerprintSchema = z.string().regex(/^[0-9a-f]{64}$/);
const GatePhaseSchema = z.enum(["before", "restart", "restore"]);
const AddressSchema = z.string().refine(isAddress, "Invalid EVM address");
const NativeUSDCAddressSchema = AddressSchema.refine(
  (value) => value.toLowerCase() === ARBITRUM_NATIVE_USDC,
  "Expected native Arbitrum USDC",
);
const RailgunAddressSchema = z.string().regex(/^0zk\S{32,256}$/);

export type MainnetGatePhase = z.infer<typeof GatePhaseSchema>;

const ReadySchema = z.object({ status: z.literal("ready") });

const RuntimeSchema = z.object({
  instanceId: z.uuid(),
  startedAt: z.number().int().nonnegative(),
  chainId: z.number().int().positive(),
  tokenAddress: AddressSchema,
  tokenSymbol: z.string(),
  tokenDecimals: z.number().int().nonnegative(),
  finalityMode: z.enum(["finalized", "confirmations"]),
  rpcProviderCount: z.number().int().positive(),
  ppoiConfiguredNodeCount: z.number().int().nonnegative(),
});

const IntentSchema = z.object({
  id: z.string().regex(/^pi_[0-9a-f]{32}$/),
  chainId: z.number().int().positive(),
  tokenAddress: AddressSchema,
  tokenSymbol: z.string(),
  decimals: z.number().int().nonnegative(),
  expectedAmountAtomic: PositiveAtomicAmountSchema,
  receivedAmountAtomic: AtomicAmountSchema,
  pendingAmountAtomic: AtomicAmountSchema,
  overpaymentAmountAtomic: AtomicAmountSchema,
  status: z.enum(["OPEN", "PARTIAL", "PAID", "EXPIRED", "PAID_LATE"]),
  expiresAt: z.number().int().positive(),
  revision: z.number().int().nonnegative(),
  payment: z.object({
    recipient: RailgunAddressSchema,
    memo: z.string().min(1),
    descriptor: SignedPaymentDescriptorSchema,
  }),
});

const SettlementSchema = z.object({
  uniqueSettlementId: z.string().min(1).max(1_024),
  intentId: z.string().regex(/^pi_[0-9a-f]{32}$/).optional(),
  chainId: z.number().int().positive(),
  txidVersion: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  tree: z.number().int().nonnegative(),
  position: z.number().int().nonnegative(),
  transactionHash: z.string().regex(/^0x[0-9a-f]{64}$/),
  tokenAddress: AddressSchema,
  amountAtomic: PositiveAtomicAmountSchema,
  blockNumber: z.number().int().nonnegative(),
  balanceBucket: z.string(),
  rawPPOIStatuses: z.record(
    z.string().min(1).max(256),
    z.string().min(1).max(128),
  ),
  chainStatus: z.enum(["OBSERVED", "CONFIRMED", "FINALIZED", "REVERTED"]),
  poiStatus: z.enum(["UNKNOWN", "PENDING", "SPENDABLE", "BLOCKED"]),
  matchStatus: z.enum(["UNMATCHED", "MATCHED", "CONFLICT"]),
});

const EventSchema = z.object({
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
  settlementId: z.string().optional(),
  intentStatus: z.enum(["OPEN", "PARTIAL", "PAID", "EXPIRED", "PAID_LATE"]),
  receivedAmountAtomic: AtomicAmountSchema,
  expectedAmountAtomic: AtomicAmountSchema,
  overpaymentAmountAtomic: AtomicAmountSchema,
});

const OutboxSchema = z.object({
  eventId: z.string().regex(/^evt_[0-9a-f]{32}$/),
  eventType: z.string(),
  attempts: z.number().int().nonnegative(),
  nextAttemptAt: z.number().int().nonnegative(),
  deliveredAt: z.number().int().nonnegative().optional(),
  deadLetteredAt: z.number().int().nonnegative().optional(),
});

const ReceiverStatsSchema = z.object({
  receivedEventCount: z.number().int().nonnegative(),
  deliveryAttemptCount: z.number().int().nonnegative(),
  duplicateDeliveryCount: z.number().int().nonnegative(),
  receivedEventsByType: z.record(z.string(), z.number().int().nonnegative()),
  deliveryAttemptsByType: z.record(z.string(), z.number().int().nonnegative()),
  duplicateDeliveriesByType: z.record(z.string(), z.number().int().nonnegative()),
  storesPayloads: z.literal(false),
});

const PreflightEvidenceSchema = z.object({
  rpcProviderCount: z.number().int().min(2),
  ppoiConfiguredNodeCount: z.number().int().positive(),
  ppoiHealthyNodeCount: z.number().int().positive(),
  latestBlock: z.number().int().nonnegative(),
  finalizedBlock: z.number().int().nonnegative(),
});

export type MainnetPreflightEvidence = z.infer<typeof PreflightEvidenceSchema>;

const SnapshotUnsignedSchema = z.object({
  schemaVersion: z.literal(1),
  phase: GatePhaseSchema,
  capturedAt: z.number().int().nonnegative(),
  result: z.literal("PASS"),
  profile: z
    .object({
      chainId: z.literal(ARBITRUM_MAINNET_CHAIN_ID),
      tokenAddress: NativeUSDCAddressSchema,
      tokenSymbol: z.literal("USDC"),
      tokenDecimals: z.literal(6),
      finalityMode: z.literal("finalized"),
      rpcProviderCount: z.number().int().min(2),
      ppoiConfiguredNodeCount: z.number().int().positive(),
      ppoiHealthyNodeCount: z.number().int().positive(),
    })
    .strict(),
  chainEvidence: z
    .object({
      latestBlock: z.number().int().nonnegative(),
      finalizedBlock: z.number().int().nonnegative(),
    })
    .strict(),
  state: z
    .object({
      serviceOriginFingerprint: FingerprintSchema,
      instanceFingerprint: FingerprintSchema,
    intentFingerprint: FingerprintSchema,
    settlementSetFingerprint: FingerprintSchema,
    settlementRpcSetFingerprint: FingerprintSchema,
    confirmationEventFingerprint: FingerprintSchema,
      intentStatus: z.enum(["PAID", "PAID_LATE"]),
      expectedAmountAtomic: PositiveAtomicAmountSchema,
      receivedAmountAtomic: PositiveAtomicAmountSchema,
      overpaymentAmountAtomic: AtomicAmountSchema,
      projectionRevision: z.number().int().positive(),
      eligibleSettlementCount: z.number().int().positive(),
      confirmationEventCount: z.literal(1),
      confirmedWebhookDelivered: z.literal(true),
      settlementRpcQuorumVerified: z.literal(true),
      confirmationDuplicateDeliveryCount: z.number().int().positive(),
    })
    .strict(),
  merchantSigner: AddressSchema,
  privacy: z
    .object({
      containsExternalReference: z.literal(false),
      containsPaymentReference: z.literal(false),
      containsTransactionIdentifiers: z.literal(false),
    })
    .strict(),
}).strict();

export const MainnetGateSnapshotSchema = SnapshotUnsignedSchema.extend({
  attestation: FingerprintSchema,
});

export type MainnetGateSnapshot = z.infer<typeof MainnetGateSnapshotSchema>;

export type SettlementRpcQuorum = {
  getTransactionReceipt: (transactionHash: string) => Promise<{
    hash: string;
    blockNumber: number;
    blockHash: string;
    status: number | null;
  } | null>;
  getBlock: (blockNumber: number) => Promise<{
    number: number;
    hash: string | null;
  }>;
};

const isLoopback = (hostname: string): boolean => {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized === "[::1]" ||
    (isIP(normalized) === 4 && normalized.split(".")[0] === "127")
  );
};

const safeUrl = (value: string, label: string): URL => {
  const url = new URL(value);
  if (url.username || url.password || url.hash) {
    throw new Error(`${label} must not contain credentials or a fragment`);
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback(url.hostname))) {
    throw new Error(`${label} requires HTTPS unless it uses loopback`);
  }
  return url;
};

const serviceOrigin = (value: string): string => {
  const url = safeUrl(value, "PPOps base URL");
  if ((url.pathname !== "/" && url.pathname !== "") || url.search) {
    throw new Error("PPOps base URL must contain only an origin");
  }
  return url.origin;
};

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
};

const keyedFingerprint = (apiToken: string, label: string, value: string): string =>
  createHmac("sha256", apiToken)
    .update(`ppops-mainnet-gate:v1:${label}:`)
    .update(value)
    .digest("hex");

const snapshotAttestation = (
  apiToken: string,
  snapshot: z.infer<typeof SnapshotUnsignedSchema>,
): string =>
  keyedFingerprint(
    apiToken,
    "snapshot-attestation",
    JSON.stringify(canonicalize(snapshot)),
  );

const fetchJson = async <T>(args: {
  url: string;
  label: string;
  schema: z.ZodType<T>;
  fetchImplementation: typeof fetch;
  authorization?: string;
  timeoutMs: number;
}): Promise<T> => {
  const response = await args.fetchImplementation(args.url, {
    method: "GET",
    headers: {
      accept: "application/json",
      ...(args.authorization
        ? { authorization: `Bearer ${args.authorization}` }
        : {}),
    },
    redirect: "error",
    signal: AbortSignal.timeout(args.timeoutMs),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`${args.label} returned HTTP ${response.status}`);
  }
  const text = await readResponseTextLimited(
    response,
    MAX_RESPONSE_BYTES,
    args.label,
  );
  let decoded: unknown;
  try {
    decoded = JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${args.label} returned invalid JSON`);
  }
  const parsed = args.schema.safeParse(decoded);
  if (!parsed.success) throw new Error(`${args.label} returned an invalid schema`);
  return parsed.data;
};

const fetchPages = async <T>(args: {
  origin: string;
  path: string;
  label: string;
  itemSchema: z.ZodType<T>;
  apiToken: string;
  timeoutMs: number;
  fetchImplementation: typeof fetch;
}): Promise<T[]> => {
  const items: T[] = [];
  const pageSchema = z.object({ items: z.array(args.itemSchema) });
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const offset = page * PAGE_SIZE;
    const result = await fetchJson({
      url: `${args.origin}${args.path}?limit=${PAGE_SIZE}&offset=${offset}`,
      label: args.label,
      schema: pageSchema,
      fetchImplementation: args.fetchImplementation,
      authorization: args.apiToken,
      timeoutMs: args.timeoutMs,
    });
    items.push(...result.items);
    if (result.items.length < PAGE_SIZE) return items;
  }
  throw new Error(`${args.label} exceeded the ${MAX_PAGES * PAGE_SIZE} item gate limit`);
};

const sameAddress = (left: string, right: string): boolean =>
  getAddress(left) === getAddress(right);

export const captureMainnetGateSnapshot = async (args: {
  phase: MainnetGatePhase;
  baseUrl: string;
  receiverStatsUrl: string;
  apiToken: string;
  intentId: string;
  expectedSigner: string;
  preflight: MainnetPreflightEvidence;
  rpcQuorum: SettlementRpcQuorum;
  timeoutMs?: number;
  now?: number;
  fetchImplementation?: typeof fetch;
}): Promise<MainnetGateSnapshot> => {
  const phase = GatePhaseSchema.parse(args.phase);
  if (!/^pi_[0-9a-f]{32}$/.test(args.intentId)) throw new Error("Invalid intent ID");
  const expectedSigner = getAddress(args.expectedSigner);
  const preflight = PreflightEvidenceSchema.parse(args.preflight);
  if (preflight.finalizedBlock > preflight.latestBlock) {
    throw new Error("Finalized block cannot exceed latest block");
  }
  if (preflight.ppoiHealthyNodeCount > preflight.ppoiConfiguredNodeCount) {
    throw new Error("Healthy PPOI node count cannot exceed configured nodes");
  }
  const origin = serviceOrigin(args.baseUrl);
  const receiverStats = safeUrl(args.receiverStatsUrl, "Receiver stats URL");
  if (receiverStats.search) throw new Error("Receiver stats URL must not contain a query");
  const timeoutMs = args.timeoutMs ?? 20_000;
  const fetchImplementation = args.fetchImplementation ?? fetch;
  const authorization = args.apiToken;

  await fetchJson({
    url: `${origin}/v1/ready`,
    label: "PPOps readiness",
    schema: ReadySchema,
    fetchImplementation,
    timeoutMs,
  });
  const runtime = await fetchJson({
    url: `${origin}/v1/runtime`,
    label: "PPOps runtime profile",
    schema: RuntimeSchema,
    fetchImplementation,
    authorization,
    timeoutMs,
  });
  const capturedAt = args.now ?? Math.floor(Date.now() / 1_000);
  if (capturedAt < runtime.startedAt) {
    throw new Error("Snapshot timestamp predates the current daemon instance");
  }
  if (
    runtime.chainId !== ARBITRUM_MAINNET_CHAIN_ID ||
    !sameAddress(runtime.tokenAddress, ARBITRUM_NATIVE_USDC) ||
    runtime.tokenSymbol !== "USDC" ||
    runtime.tokenDecimals !== 6 ||
    runtime.finalityMode !== "finalized" ||
    runtime.rpcProviderCount !== preflight.rpcProviderCount ||
    runtime.ppoiConfiguredNodeCount !== preflight.ppoiConfiguredNodeCount
  ) {
    throw new Error("Runtime does not match the strict Arbitrum native-USDC profile");
  }

  const intent = await fetchJson({
    url: `${origin}/v1/intents/${encodeURIComponent(args.intentId)}`,
    label: "Payment intent",
    schema: IntentSchema,
    fetchImplementation,
    authorization,
    timeoutMs,
  });
  const descriptor = intent.payment.descriptor;
  verifySignedDescriptor(descriptor, expectedSigner);
  if (
    intent.id !== args.intentId ||
    intent.chainId !== ARBITRUM_MAINNET_CHAIN_ID ||
    !sameAddress(intent.tokenAddress, ARBITRUM_NATIVE_USDC) ||
    intent.tokenSymbol !== "USDC" ||
    intent.decimals !== 6 ||
    descriptor.chainId !== intent.chainId ||
    !sameAddress(descriptor.tokenAddress, intent.tokenAddress) ||
    descriptor.decimals !== intent.decimals ||
    descriptor.amountAtomic !== intent.expectedAmountAtomic ||
    descriptor.recipient0zk !== intent.payment.recipient ||
    descriptor.expiresAt !== intent.expiresAt ||
    intent.payment.memo !== memoForReference(descriptor.reference)
  ) {
    throw new Error("Intent and signed descriptor do not agree");
  }
  if (intent.status !== "PAID" && intent.status !== "PAID_LATE") {
    throw new Error("Intent has not reached a paid state");
  }
  if (intent.pendingAmountAtomic !== "0") {
    throw new Error("Intent still has pending matched value");
  }

  const settlements = (
    await fetchPages({
      origin,
      path: "/v1/settlements",
      label: "Settlements",
      itemSchema: SettlementSchema,
      apiToken: authorization,
      timeoutMs,
      fetchImplementation,
    })
  ).filter((settlement) => settlement.intentId === intent.id);
  if (settlements.length === 0) throw new Error("Intent has no matched settlements");
  if (new Set(settlements.map((settlement) => settlement.uniqueSettlementId)).size !== settlements.length) {
    throw new Error("Settlement list contains duplicate identities");
  }
  const settlementRpcEvidence: Array<{
    uniqueSettlementId: string;
    transactionHash: string;
    blockNumber: number;
    blockHash: string;
  }> = [];
  for (const settlement of settlements) {
    const canonicalSettlementId =
      `${settlement.chainId}:${settlement.txidVersion}:` +
      `${settlement.transactionHash.toLowerCase()}:${settlement.tree}:${settlement.position}`;
    if (
      settlement.chainId !== ARBITRUM_MAINNET_CHAIN_ID ||
      settlement.uniqueSettlementId !== canonicalSettlementId ||
      !sameAddress(settlement.tokenAddress, ARBITRUM_NATIVE_USDC) ||
      settlement.chainStatus !== "FINALIZED" ||
      settlement.poiStatus !== "SPENDABLE" ||
      settlement.balanceBucket !== "Spendable" ||
      settlement.matchStatus !== "MATCHED"
    ) {
      throw new Error("Every matched pilot settlement must be finalized and spendable");
    }
    if (settlement.blockNumber > preflight.finalizedBlock) {
      throw new Error("A pilot settlement is above the current finalized height");
    }
    const receipt = await args.rpcQuorum.getTransactionReceipt(
      settlement.transactionHash,
    );
    if (
      !receipt ||
      receipt.status !== 1 ||
      receipt.hash.toLowerCase() !== settlement.transactionHash.toLowerCase() ||
      receipt.blockNumber !== settlement.blockNumber ||
      !/^0x[0-9a-f]{64}$/i.test(receipt.blockHash)
    ) {
      throw new Error("RPC quorum did not confirm the stored settlement receipt");
    }
    const block = await args.rpcQuorum.getBlock(receipt.blockNumber);
    if (
      block.number !== receipt.blockNumber ||
      !block.hash ||
      block.hash.toLowerCase() !== receipt.blockHash.toLowerCase()
    ) {
      throw new Error("RPC quorum did not confirm the settlement block hash");
    }
    settlementRpcEvidence.push({
      uniqueSettlementId: settlement.uniqueSettlementId,
      transactionHash: settlement.transactionHash,
      blockNumber: settlement.blockNumber,
      blockHash: receipt.blockHash.toLowerCase(),
    });
  }
  const received = settlements.reduce(
    (sum, settlement) => sum + BigInt(settlement.amountAtomic),
    0n,
  );
  if (received.toString() !== intent.receivedAmountAtomic) {
    throw new Error("Eligible settlements do not conserve the projected received amount");
  }
  const expected = BigInt(intent.expectedAmountAtomic);
  if (received < expected) throw new Error("Eligible settlements do not cover the intent");
  if ((received - expected).toString() !== intent.overpaymentAmountAtomic) {
    throw new Error("Intent overpayment projection is inconsistent");
  }

  const events = (
    await fetchPages({
      origin,
      path: "/v1/events",
      label: "Events",
      itemSchema: EventSchema,
      apiToken: authorization,
      timeoutMs,
      fetchImplementation,
    })
  ).filter((event) => event.intentId === intent.id);
  const confirmations = events.filter((event) => event.type === "payment.confirmed");
  if (confirmations.length !== 1) {
    throw new Error("Pilot intent must have exactly one payment.confirmed event");
  }
  if (events.some((event) => event.type === "payment.reverted")) {
    throw new Error("Pilot intent contains a payment.reverted event");
  }
  const confirmation = confirmations[0];
  if (
    !confirmation ||
    confirmation.intentStatus !== intent.status ||
    confirmation.receivedAmountAtomic !== intent.receivedAmountAtomic ||
    confirmation.expectedAmountAtomic !== intent.expectedAmountAtomic ||
    confirmation.overpaymentAmountAtomic !== intent.overpaymentAmountAtomic
  ) {
    throw new Error("Confirmation event does not match the current intent projection");
  }

  const outbox = await fetchPages({
    origin,
    path: "/v1/outbox",
    label: "Outbox",
    itemSchema: OutboxSchema,
    apiToken: authorization,
    timeoutMs,
    fetchImplementation,
  });
  const confirmationDelivery = outbox.filter(
    (record) => record.eventId === confirmation.eventId,
  );
  if (
    confirmationDelivery.length !== 1 ||
    confirmationDelivery[0]?.eventType !== "payment.confirmed" ||
    confirmationDelivery[0].attempts < 1 ||
    confirmationDelivery[0].deliveredAt === undefined ||
    confirmationDelivery[0].deadLetteredAt !== undefined
  ) {
    throw new Error("The single confirmation outbox record has not been delivered successfully");
  }

  const receiver = await fetchJson({
    url: receiverStats.href,
    label: "Pilot receiver statistics",
    schema: ReceiverStatsSchema,
    fetchImplementation,
    timeoutMs,
  });
  const distinctReceiverCount = Object.values(receiver.receivedEventsByType).reduce(
    (sum, count) => sum + count,
    0,
  );
  const receiverAttemptCount = Object.values(receiver.deliveryAttemptsByType).reduce(
    (sum, count) => sum + count,
    0,
  );
  const receiverEventTypes = new Set([
    ...Object.keys(receiver.receivedEventsByType),
    ...Object.keys(receiver.deliveryAttemptsByType),
    ...Object.keys(receiver.duplicateDeliveriesByType),
  ]);
  for (const eventType of receiverEventTypes) {
    const receivedEvents = receiver.receivedEventsByType[eventType] ?? 0;
    const attempts = receiver.deliveryAttemptsByType[eventType] ?? 0;
    if (
      attempts < receivedEvents ||
      receiver.duplicateDeliveriesByType[eventType] !==
        attempts - receivedEvents
    ) {
      throw new Error("Pilot receiver per-type delivery counters are inconsistent");
    }
  }
  if (
    receiver.receivedEventsByType["payment.confirmed"] !== 1 ||
    (receiver.deliveryAttemptsByType["payment.confirmed"] ?? 0) < 2 ||
    (receiver.duplicateDeliveriesByType["payment.confirmed"] ?? 0) < 1 ||
    receiver.receivedEventCount !== distinctReceiverCount ||
    receiver.deliveryAttemptCount !== receiverAttemptCount ||
    receiver.deliveryAttemptCount < receiver.receivedEventCount ||
    receiver.duplicateDeliveryCount !==
      receiver.deliveryAttemptCount - receiver.receivedEventCount ||
    receiver.duplicateDeliveryCount < 1
  ) {
    throw new Error("Pilot receiver has not proven durable confirmation deduplication");
  }

  const unsigned = SnapshotUnsignedSchema.parse({
    schemaVersion: 1,
    phase,
    capturedAt,
    result: "PASS",
    profile: {
      chainId: ARBITRUM_MAINNET_CHAIN_ID,
      tokenAddress: getAddress(ARBITRUM_NATIVE_USDC),
      tokenSymbol: "USDC",
      tokenDecimals: 6,
      finalityMode: "finalized",
      rpcProviderCount: preflight.rpcProviderCount,
      ppoiConfiguredNodeCount: preflight.ppoiConfiguredNodeCount,
      ppoiHealthyNodeCount: preflight.ppoiHealthyNodeCount,
    },
    chainEvidence: {
      latestBlock: preflight.latestBlock,
      finalizedBlock: preflight.finalizedBlock,
    },
    state: {
      serviceOriginFingerprint: keyedFingerprint(authorization, "origin", origin),
      instanceFingerprint: keyedFingerprint(
        authorization,
        "instance",
        runtime.instanceId,
      ),
      intentFingerprint: keyedFingerprint(authorization, "intent", intent.id),
      settlementSetFingerprint: keyedFingerprint(
        authorization,
        "settlements",
        JSON.stringify(
          canonicalize(
            settlements
              .map((settlement) => ({
                uniqueSettlementId: settlement.uniqueSettlementId,
                amountAtomic: settlement.amountAtomic,
                blockNumber: settlement.blockNumber,
                balanceBucket: settlement.balanceBucket,
                rawPPOIStatuses: settlement.rawPPOIStatuses,
                chainStatus: settlement.chainStatus,
                poiStatus: settlement.poiStatus,
                matchStatus: settlement.matchStatus,
              }))
              .sort((left, right) =>
                left.uniqueSettlementId.localeCompare(right.uniqueSettlementId),
              ),
          ),
        ),
      ),
      settlementRpcSetFingerprint: keyedFingerprint(
        authorization,
        "settlement-rpc-evidence",
        JSON.stringify(
          canonicalize(
            settlementRpcEvidence.sort((left, right) =>
              left.uniqueSettlementId.localeCompare(right.uniqueSettlementId),
            ),
          ),
        ),
      ),
      confirmationEventFingerprint: keyedFingerprint(
        authorization,
        "confirmation-event",
        confirmation.eventId,
      ),
      intentStatus: intent.status,
      expectedAmountAtomic: intent.expectedAmountAtomic,
      receivedAmountAtomic: intent.receivedAmountAtomic,
      overpaymentAmountAtomic: intent.overpaymentAmountAtomic,
      projectionRevision: intent.revision,
      eligibleSettlementCount: settlements.length,
      confirmationEventCount: 1,
      confirmedWebhookDelivered: true,
      settlementRpcQuorumVerified: true,
      confirmationDuplicateDeliveryCount:
        receiver.duplicateDeliveriesByType["payment.confirmed"] ?? 0,
    },
    merchantSigner: expectedSigner,
    privacy: {
      containsExternalReference: false,
      containsPaymentReference: false,
      containsTransactionIdentifiers: false,
    },
  });
  return MainnetGateSnapshotSchema.parse({
    ...unsigned,
    attestation: snapshotAttestation(authorization, unsigned),
  });
};

const assertSnapshotAttestation = (
  snapshot: MainnetGateSnapshot,
  apiToken: string,
): void => {
  const { attestation, ...unsignedValue } = snapshot;
  const unsigned = SnapshotUnsignedSchema.parse(unsignedValue);
  if (snapshotAttestation(apiToken, unsigned) !== attestation) {
    throw new Error(`Snapshot ${snapshot.phase} failed its keyed attestation`);
  }
};

export const MainnetGateReportSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.number().int().nonnegative(),
  result: z.literal("PASS"),
  profile: SnapshotUnsignedSchema.shape.profile,
  merchantSigner: AddressSchema,
  checks: z
    .object({
      snapshotsAuthenticated: z.literal("PASS"),
      distinctDaemonInstances: z.literal("PASS"),
      restartStateStable: z.literal("PASS"),
      restoreStateStable: z.literal("PASS"),
      restoredInstanceIsolated: z.literal("PASS"),
      settlementRpcQuorumVerified: z.literal("PASS"),
      singleConfirmationStable: z.literal("PASS"),
      receiverDeduplication: z.literal("PASS"),
      redactedEvidence: z.literal("PASS"),
    })
    .strict(),
  evidence: z
    .object({
      intentFingerprint: FingerprintSchema,
      settlementSetFingerprint: FingerprintSchema,
      settlementRpcSetFingerprint: FingerprintSchema,
      confirmationEventFingerprint: FingerprintSchema,
      beforeCapturedAt: z.number().int().nonnegative(),
      restartCapturedAt: z.number().int().nonnegative(),
      restoreCapturedAt: z.number().int().nonnegative(),
    })
    .strict(),
  limitations: z.array(z.string().min(1)).min(1),
}).strict();

export type MainnetGateReport = z.infer<typeof MainnetGateReportSchema>;

export const SignedMainnetGateReportSchema = MainnetGateReportSchema.extend({
  reportSignature: z.object({
    scheme: z.literal("EIP-191"),
    signer: AddressSchema,
    signature: z.string().regex(/^0x[0-9a-f]{130}$/i),
  }).strict(),
});

export type SignedMainnetGateReport = z.infer<typeof SignedMainnetGateReportSchema>;

export const verifyMainnetGateSnapshots = (args: {
  before: unknown;
  restart: unknown;
  restore: unknown;
  apiToken: string;
  now?: number;
}): MainnetGateReport => {
  const before = MainnetGateSnapshotSchema.parse(args.before);
  const restart = MainnetGateSnapshotSchema.parse(args.restart);
  const restore = MainnetGateSnapshotSchema.parse(args.restore);
  if (before.phase !== "before" || restart.phase !== "restart" || restore.phase !== "restore") {
    throw new Error("Mainnet gate requires before, restart and restore snapshots in order");
  }
  for (const snapshot of [before, restart, restore]) {
    assertSnapshotAttestation(snapshot, args.apiToken);
  }
  if (!(before.capturedAt <= restart.capturedAt && restart.capturedAt <= restore.capturedAt)) {
    throw new Error("Mainnet gate snapshots are not chronologically ordered");
  }
  const profile = JSON.stringify(canonicalize(before.profile));
  if (
    JSON.stringify(canonicalize(restart.profile)) !== profile ||
    JSON.stringify(canonicalize(restore.profile)) !== profile
  ) {
    throw new Error("Mainnet gate profiles changed across recovery phases");
  }
  const stableStateFields = [
    "intentFingerprint",
    "settlementSetFingerprint",
    "settlementRpcSetFingerprint",
    "confirmationEventFingerprint",
    "intentStatus",
    "expectedAmountAtomic",
    "receivedAmountAtomic",
    "overpaymentAmountAtomic",
    "projectionRevision",
    "eligibleSettlementCount",
    "confirmationEventCount",
    "confirmedWebhookDelivered",
    "settlementRpcQuorumVerified",
  ] as const;
  for (const field of stableStateFields) {
    if (
      restart.state[field] !== before.state[field] ||
      restore.state[field] !== before.state[field]
    ) {
      throw new Error(`Mainnet gate state changed across recovery phases: ${field}`);
    }
  }
  const instances = new Set([
    before.state.instanceFingerprint,
    restart.state.instanceFingerprint,
    restore.state.instanceFingerprint,
  ]);
  if (instances.size !== 3) {
    throw new Error("Each recovery phase must come from a distinct daemon instance");
  }
  if (before.state.serviceOriginFingerprint !== restart.state.serviceOriginFingerprint) {
    throw new Error("Before and restart snapshots must use the same service origin");
  }
  if (restore.state.serviceOriginFingerprint === before.state.serviceOriginFingerprint) {
    throw new Error("Restore snapshot must use an isolated service origin");
  }
  if (
    before.merchantSigner !== restart.merchantSigner ||
    before.merchantSigner !== restore.merchantSigner
  ) {
    throw new Error("Merchant identity changed across recovery phases");
  }
  if (
    before.state.confirmationDuplicateDeliveryCount < 1 ||
    restart.state.confirmationDuplicateDeliveryCount < 1 ||
    restore.state.confirmationDuplicateDeliveryCount < 1
  ) {
    throw new Error("Receiver deduplication evidence is incomplete");
  }
  const generatedAt = args.now ?? Math.floor(Date.now() / 1_000);
  if (generatedAt < restore.capturedAt) {
    throw new Error("Mainnet gate report timestamp predates its restore snapshot");
  }
  return {
    schemaVersion: 1,
    generatedAt,
    result: "PASS",
    profile: before.profile,
    merchantSigner: before.merchantSigner,
    checks: {
      snapshotsAuthenticated: "PASS",
      distinctDaemonInstances: "PASS",
      restartStateStable: "PASS",
      restoreStateStable: "PASS",
      restoredInstanceIsolated: "PASS",
      settlementRpcQuorumVerified: "PASS",
      singleConfirmationStable: "PASS",
      receiverDeduplication: "PASS",
      redactedEvidence: "PASS",
    },
    evidence: {
      intentFingerprint: before.state.intentFingerprint,
      settlementSetFingerprint: before.state.settlementSetFingerprint,
      settlementRpcSetFingerprint: before.state.settlementRpcSetFingerprint,
      confirmationEventFingerprint: before.state.confirmationEventFingerprint,
      beforeCapturedAt: before.capturedAt,
      restartCapturedAt: restart.capturedAt,
      restoreCapturedAt: restore.capturedAt,
    },
    limitations: [
      "The report authenticates PPOps state snapshots; operator command records are still required to establish the exact restart and restore procedure.",
      "A self-pilot is engineering evidence, not independent merchant adoption.",
      "The report deliberately omits invoice references, payment references and transaction identifiers.",
    ],
  };
};

const reportSigningMessage = (report: MainnetGateReport): string =>
  `PPOps mainnet gate report v1\n${JSON.stringify(canonicalize(report))}`;

export const signMainnetGateReport = async (
  reportValue: unknown,
  merchantPrivateKey: string,
): Promise<SignedMainnetGateReport> => {
  const report = MainnetGateReportSchema.parse(reportValue);
  const wallet = new Wallet(merchantPrivateKey);
  if (getAddress(report.merchantSigner) !== wallet.address) {
    throw new Error("Mainnet gate report merchant does not match the signing key");
  }
  const signature = await wallet.signMessage(reportSigningMessage(report));
  return SignedMainnetGateReportSchema.parse({
    ...report,
    reportSignature: {
      scheme: "EIP-191",
      signer: wallet.address,
      signature,
    },
  });
};

export const verifySignedMainnetGateReport = (
  reportValue: unknown,
  expectedSigner: string,
): SignedMainnetGateReport => {
  const signed = SignedMainnetGateReportSchema.parse(reportValue);
  const { reportSignature, ...unsignedValue } = signed;
  const report = MainnetGateReportSchema.parse(unsignedValue);
  const trustedSigner = getAddress(expectedSigner);
  const recovered = getAddress(
    verifyMessage(reportSigningMessage(report), reportSignature.signature),
  );
  if (
    getAddress(report.merchantSigner) !== trustedSigner ||
    getAddress(reportSignature.signer) !== trustedSigner ||
    recovered !== trustedSigner
  ) {
    throw new Error("Mainnet gate report does not match the trusted merchant signer");
  }
  return signed;
};

export const replayConfirmedWebhookForGate = async (args: {
  baseUrl: string;
  webhookUrl: string;
  apiToken: string;
  webhookHmacKeyHex: string;
  keyId: string;
  intentId: string;
  timeoutMs?: number;
  now?: number;
  fetchImplementation?: typeof fetch;
}): Promise<{ ok: true; idempotentReplay: true }> => {
  if (!/^pi_[0-9a-f]{32}$/.test(args.intentId)) throw new Error("Invalid intent ID");
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(args.keyId)) throw new Error("Invalid webhook key ID");
  const origin = serviceOrigin(args.baseUrl);
  const webhookUrl = safeUrl(args.webhookUrl, "Webhook URL");
  if (webhookUrl.search) throw new Error("Webhook URL must not contain a query");
  const timeoutMs = args.timeoutMs ?? 20_000;
  const fetchImplementation = args.fetchImplementation ?? fetch;
  const events = (
    await fetchPages({
      origin,
      path: "/v1/events",
      label: "Events",
      itemSchema: EventSchema,
      apiToken: args.apiToken,
      timeoutMs,
      fetchImplementation,
    })
  ).filter(
    (event) => event.intentId === args.intentId && event.type === "payment.confirmed",
  );
  if (events.length !== 1) {
    throw new Error("Pilot intent must have exactly one payment.confirmed event to replay");
  }
  const event = events[0];
  if (!event) throw new Error("Confirmation event disappeared");
  const payloadJson = JSON.stringify(event);
  const timestamp = args.now ?? Math.floor(Date.now() / 1_000);
  const response = await fetchImplementation(webhookUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "ppops-event-id": event.eventId,
      "ppops-timestamp": timestamp.toString(),
      "ppops-key-id": args.keyId,
      "ppops-signature": webhookSignature(
        args.webhookHmacKeyHex,
        timestamp,
        event.eventId,
        payloadJson,
        args.keyId,
      ),
    },
    body: payloadJson,
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs),
  });
  await response.body?.cancel();
  if (response.status !== 204 || response.headers.get("idempotent-replayed") !== "true") {
    throw new Error(
      "Receiver did not recognize the confirmation as an already persisted identical event",
    );
  }
  return { ok: true, idempotentReplay: true };
};
