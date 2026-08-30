import type { Block, TransactionReceipt } from "ethers";
import { RailgunWalletBalanceBucket } from "@railgun-community/shared-models";
import { describe, expect, it, vi } from "vitest";

import {
  RpcQuorum,
  type RpcProviderLike,
} from "../src/railgun/rpc-quorum.js";
import {
  bucketToPOIStatus,
  chainStatusWhenReceiptMissing,
} from "../src/railgun/scanner.js";

const block = (number: number, hashByte = "ab"): Block =>
  ({
    number,
    hash: `0x${hashByte.repeat(32)}`,
    timestamp: 1_700_000_000 + number,
  }) as Block;

const receipt = (blockNumber: number, hashByte = "ab"): TransactionReceipt =>
  ({
    hash: `0x${"12".repeat(32)}`,
    blockNumber,
    blockHash: `0x${hashByte.repeat(32)}`,
    index: 0,
    status: 1,
  }) as TransactionReceipt;

const provider = (settings: {
  latest: number;
  finalized: number;
  receipt?: TransactionReceipt | null;
  failLatest?: boolean;
  hashByte?: string;
  chainIdHex?: string;
}): RpcProviderLike =>
  ({
    getBlockNumber: vi.fn(async () => {
      if (settings.failLatest) throw new Error("offline");
      return settings.latest;
    }),
    getBlock: vi.fn(async (tag: number | string) => {
      if (tag === "finalized") return block(settings.finalized);
      return block(Number(tag), settings.hashByte);
    }),
    getTransactionReceipt: vi.fn(async () => settings.receipt ?? null),
    send: vi.fn(async () => settings.chainIdHex ?? "0xa4b1"),
    destroy: vi.fn(),
  }) as unknown as RpcProviderLike;

const quorumFor = (providers: RpcProviderLike[]): RpcQuorum =>
  new RpcQuorum({
    chainId: 42_161,
    rpcUrls: providers.map((_, index) => `https://rpc-${index}.example`),
    timeoutMs: 1_000,
    maxBlockLag: 5,
    providers,
  });

describe("RPC quorum", () => {
  it("uses the conservative height when independent RPCs are slightly apart", async () => {
    const transactionReceipt = receipt(95);
    const quorum = quorumFor([
      provider({ latest: 101, finalized: 90, receipt: transactionReceipt }),
      provider({ latest: 103, finalized: 91, receipt: transactionReceipt }),
    ]);
    await expect(quorum.chainContext(true)).resolves.toEqual({
      latestBlock: 101,
      finalizedBlock: 90,
    });
    await expect(quorum.getTransactionReceipt("0xtest")).resolves.toBe(
      transactionReceipt,
    );
    await quorum.close();
  });

  it("fails closed when two providers disagree on a receipt", async () => {
    const quorum = quorumFor([
      provider({ latest: 100, finalized: 90, receipt: receipt(95, "ab") }),
      provider({ latest: 100, finalized: 90, receipt: receipt(95, "cd") }),
    ]);
    await expect(quorum.getTransactionReceipt("0xtest")).rejects.toThrow(
      /could not agree/,
    );
    await quorum.close();
  });

  it("rejects RPCs connected to the wrong chain", async () => {
    const quorum = quorumFor([
      provider({ latest: 100, finalized: 90, chainIdHex: "0x1" }),
      provider({ latest: 100, finalized: 90, chainIdHex: "0x1" }),
    ]);
    await expect(quorum.chainContext(true)).rejects.toThrow(/chain ID does not match/);
    await quorum.close();
  });

  it("tolerates one failed or outlying provider when two agree", async () => {
    const transactionReceipt = receipt(95);
    const quorum = quorumFor([
      provider({ latest: 100, finalized: 90, receipt: transactionReceipt }),
      provider({ latest: 101, finalized: 90, receipt: transactionReceipt }),
      provider({ latest: 10_000, finalized: 9_000, failLatest: true }),
    ]);
    await expect(quorum.chainContext(false)).resolves.toEqual({ latestBlock: 100 });
    await expect(quorum.getTransactionReceipt("0xtest")).resolves.toBe(
      transactionReceipt,
    );
    await quorum.close();
  });

  it("retries a transient provider failure without weakening the quorum", async () => {
    const first = provider({ latest: 100, finalized: 90 });
    const second = provider({ latest: 101, finalized: 90 });
    vi.mocked(second.getBlockNumber)
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValue(101);
    const quorum = quorumFor([first, second]);

    await expect(quorum.chainContext(false)).resolves.toEqual({ latestBlock: 100 });
    expect(second.getBlockNumber).toHaveBeenCalledTimes(2);
    await quorum.close();
  });
});

describe("PPOI fail-closed mapping", () => {
  it("credits only Spendable and treats missing proofs as pending", () => {
    expect(
      bucketToPOIStatus(RailgunWalletBalanceBucket.Spendable, { list: "Valid" }),
    ).toBe("SPENDABLE");
    for (const bucket of [
      RailgunWalletBalanceBucket.ShieldPending,
      RailgunWalletBalanceBucket.ProofSubmitted,
      RailgunWalletBalanceBucket.MissingInternalPOI,
      RailgunWalletBalanceBucket.MissingExternalPOI,
    ]) {
      expect(bucketToPOIStatus(bucket, {})).toBe("PENDING");
    }
    expect(bucketToPOIStatus(RailgunWalletBalanceBucket.ShieldBlocked, {})).toBe(
      "BLOCKED",
    );
  });

  it("does not label a newly observed note reverted before its receipt is visible", () => {
    expect(chainStatusWhenReceiptMissing()).toBe("OBSERVED");
    expect(chainStatusWhenReceiptMissing("CONFIRMED")).toBe("OBSERVED");
    expect(chainStatusWhenReceiptMissing("FINALIZED")).toBe("REVERTED");
  });
});
