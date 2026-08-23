import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  memoForReference,
  parsePPOpsReference,
  type IntentProjection,
  type PaymentIntentRecord,
  type SettlementRecord,
} from "../src/domain.js";
import { deriveProjection } from "../src/reconciliation/projection.js";

const projection: IntentProjection = {
  intentId: "pi_property",
  status: "OPEN",
  receivedAmountAtomic: "0",
  pendingAmountAtomic: "0",
  overpaymentAmountAtomic: "0",
  revision: 0,
  updatedAt: 1,
};

const intentFor = (expectedAmountAtomic: bigint): PaymentIntentRecord => ({
  id: "pi_property",
  externalReference: "property-test",
  reference: `0x${"ab".repeat(32)}`,
  chainId: 42_161,
  tokenAddress: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  tokenSymbol: "USDC",
  decimals: 6,
  expectedAmountAtomic: expectedAmountAtomic.toString(),
  recipient0zk: "0zk-property",
  expiresAt: 10_000,
  descriptor: {
    version: 1,
    chainId: 42_161,
    rail: "railgun",
    tokenAddress: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    decimals: 6,
    amountAtomic: expectedAmountAtomic.toString(),
    recipient0zk: "0zk-property",
    reference: `0x${"ab".repeat(32)}`,
    expiresAt: 10_000,
    nonce: `0x${"cd".repeat(32)}`,
    merchantSigner: "0x00000000000000000000000000000000000000A1",
    signature: `0x${"ef".repeat(65)}`,
  },
  createdAt: 1,
});

type SettlementKind = "credit" | "pending" | "reverted" | "unmatched";

const settlementFor = (
  amount: bigint,
  position: number,
  kind: SettlementKind,
): SettlementRecord => ({
  uniqueSettlementId: `42161:V2:0x${position.toString(16).padStart(64, "0")}:0:${position}`,
  chainId: 42_161,
  txidVersion: "V2",
  tree: 0,
  position,
  transactionHash: `0x${position.toString(16).padStart(64, "0")}`,
  tokenAddress: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  amountAtomic: amount.toString(),
  blockNumber: 1_000 + position,
  blockTimestamp: 5_000 + position,
  balanceBucket: kind === "credit" ? "Spendable" : "MissingExternalPOI",
  rawPPOIStatuses: {},
  chainStatus:
    kind === "reverted" ? "REVERTED" : kind === "credit" ? "FINALIZED" : "CONFIRMED",
  poiStatus: kind === "credit" ? "SPENDABLE" : "PENDING",
  matchStatus: kind === "unmatched" ? "UNMATCHED" : "MATCHED",
  reference: `0x${"ab".repeat(32)}`,
  intentId: "pi_property",
  firstSeenAt: 1,
  lastSeenAt: 1,
});

describe("reconciliation properties", () => {
  it("is invariant to input ordering and conserves eligible and pending amounts", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 1_000_000_000_000n }),
        fc.array(
          fc.record({
            amount: fc.bigInt({ min: 1n, max: 1_000_000_000_000n }),
            kind: fc.constantFrom<SettlementKind>(
              "credit",
              "pending",
              "reverted",
              "unmatched",
            ),
          }),
          { maxLength: 80 },
        ),
        (expected, generated) => {
          const settlements = generated.map((item, index) =>
            settlementFor(item.amount, index + 1, item.kind),
          );
          const forward = deriveProjection(intentFor(expected), settlements, projection, 7_000);
          const reversed = deriveProjection(
            intentFor(expected),
            [...settlements].reverse(),
            projection,
            7_000,
          );
          expect(reversed).toEqual(forward);

          const credited = generated
            .filter((item) => item.kind === "credit")
            .reduce((sum, item) => sum + item.amount, 0n);
          const pending = generated
            .filter((item) => item.kind === "pending")
            .reduce((sum, item) => sum + item.amount, 0n);
          expect(BigInt(forward.receivedAmountAtomic)).toBe(credited);
          expect(BigInt(forward.pendingAmountAtomic)).toBe(pending);
          expect(BigInt(forward.overpaymentAmountAtomic)).toBe(
            credited > expected ? credited - expected : 0n,
          );
        },
      ),
      { numRuns: 500 },
    );
  });

  it("round-trips every 32-byte opaque reference and rejects suffixes", () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: 32, maxLength: 32 }),
        (bytes) => {
          const reference = `0x${Buffer.from(bytes).toString("hex")}`;
          const memo = memoForReference(reference);
          expect(parsePPOpsReference(memo)).toBe(reference);
          expect(parsePPOpsReference(`${memo}:invoice`)).toBeUndefined();
        },
      ),
      { numRuns: 500 },
    );
  });
});
