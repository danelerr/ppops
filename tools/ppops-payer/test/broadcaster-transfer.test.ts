import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SelectedBroadcaster } from "@railgun-community/shared-models";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  BroadcasterSession,
  PreparedBroadcasterSubmission,
} from "../src/broadcaster/session.js";
import type { PayerConfig } from "../src/config.js";
import { SafeFailure } from "../src/events.js";
import type { PaymentRequest } from "../src/request.js";
import type { PayerRailgunEngine } from "../src/railgun/engine.js";
import {
  assertBroadcasterFeeWithinLimit,
  parseBroadcasterFeeLimit,
  sendBroadcasterTransfer,
} from "../src/railgun/broadcaster-transfer.js";
import {
  SubmissionJournal,
  submissionJournalPath,
} from "../src/security/submission-journal.js";

const walletMocks = vi.hoisted(() => ({
  calculateFee: vi.fn(),
  estimate: vi.fn(),
  generateProof: vi.fn(),
  populate: vi.fn(),
}));
const rpcMocks = vi.hoisted(() => ({
  readGas: vi.fn(),
  readReceipt: vi.fn(),
}));
const requestMocks = vi.hoisted(() => ({
  current: undefined as unknown,
}));

vi.mock("@railgun-community/wallet", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@railgun-community/wallet")>()),
  calculateBroadcasterFeeERC20Amount: walletMocks.calculateFee,
  gasEstimateForUnprovenTransfer: walletMocks.estimate,
  generateTransferProof: walletMocks.generateProof,
  populateProvedTransfer: walletMocks.populate,
}));

vi.mock("../src/railgun/rpc-quorum.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/railgun/rpc-quorum.js")>()),
  readConservativeLegacyGasPrice: rpcMocks.readGas,
  readReceiptQuorum: rpcMocks.readReceipt,
}));

vi.mock("../src/request.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/request.js")>()),
  loadPaymentRequest: vi.fn(async () => requestMocks.current),
  verifyPaymentRequest: vi.fn((value: unknown) => value),
}));

const PROXY = "0x0000000000000000000000000000000000001234";
const BROADCASTER_ADDRESS =
  "0zk1qyjyhqjdkqd9qxusgj092ppxl92plvrk3s3cna9u73h5rwt0ghxvfrv7j6fe3z53l7lrzyqw5te7ku5v8fsrpeadzvpkudgawjv9dg08htj7z3mph5kd6dw50jc";
const TX_HASH = `0x${"88".repeat(32)}`;
const CANONICAL_TX_HASH = `0x${"99".repeat(32)}`;
const NULLIFIER = `0x${"77".repeat(32)}`;
const roots: string[] = [];

const paymentRequest = (): PaymentRequest => ({
  id: `pi_${"12".repeat(16)}`,
  chainId: 42_161,
  tokenAddress: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  tokenSymbol: "USDC",
  decimals: 6,
  amountAtomic: "10000",
  amountFormatted: "0.01",
  receivedAmountAtomic: "0",
  pendingAmountAtomic: "0",
  status: "OPEN",
  expiresAt: 2_000_000_000,
  rail: "railgun",
  recipient: BROADCASTER_ADDRESS,
  memo: `ppops:v1:0x${"ab".repeat(32)}`,
  expectedMerchantSigner: `0x${"11".repeat(20)}`,
  descriptor: {
    version: 1,
    chainId: 42_161,
    rail: "railgun",
    tokenAddress: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    decimals: 6,
    amountAtomic: "10000",
    recipient0zk: BROADCASTER_ADDRESS,
    reference: `0x${"ab".repeat(32)}`,
    expiresAt: 2_000_000_000,
    nonce: `0x${"cd".repeat(32)}`,
    merchantSigner: `0x${"11".repeat(20)}`,
    signature: `0x${"ef".repeat(65)}`,
  },
});

const selected = (): Awaited<ReturnType<BroadcasterSession["discover"]>> => {
  const quote: SelectedBroadcaster = {
    railgunAddress: BROADCASTER_ADDRESS,
    tokenAddress: "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
    tokenFee: {
      feePerUnitGas: "1000000000000",
      expiration: Date.now() + 120_000,
      feesID: "fee-id",
      availableWallets: 1,
      relayAdapt: "false",
      reliability: 0.9,
    },
  };
  return { selected: quote, feePerUnitGas: 1_000_000_000_000n, fingerprint: "aa".repeat(32) };
};

const testContext = async (): Promise<{
  config: PayerConfig;
  engine: PayerRailgunEngine;
  request: PaymentRequest;
}> => {
  const root = await mkdtemp(join(tmpdir(), "ppops-broadcaster-transfer-"));
  roots.push(root);
  const config = {
    schemaVersion: 1,
    network: {
      railgunNetworkName: "Arbitrum",
      chainId: 42_161,
      tokenAddress: "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
      tokenSymbol: "USDC",
      tokenDecimals: 6,
      deploymentBlock: 0,
      walletCreationBlock: 1,
      rpcUrls: ["https://rpc-one.example", "https://rpc-two.example"],
    },
    poiNodeUrls: ["https://poi.example"],
    storage: {
      railgunDbPath: join(root, "railgun-db"),
      artifactsPath: join(root, "artifacts"),
      walletStatePath: join(root, "wallet-state.json"),
    },
    secrets: {
      dbEncryptionKeyFile: join(root, "db-key"),
      mnemonicFile: join(root, "mnemonic"),
      selfSigningKeyFile: join(root, "evm-key"),
    },
    scanner: { providerPollingIntervalMs: 10_000 },
  } as PayerConfig;
  const engine = {
    walletID: "wallet-id",
    railgunAddress: BROADCASTER_ADDRESS,
    network: { proxyContract: PROXY },
    spendableBalance: vi.fn(async () => 100_000n),
    syncBalances: vi.fn(async () => ({})),
    recoverTransactionHashForNullifiers: vi.fn(async () => TX_HASH),
  } as unknown as PayerRailgunEngine;
  const request = paymentRequest();
  requestMocks.current = request;
  return { config, engine, request };
};

const fakeSession = (
  send: () => Promise<string> = vi.fn(async () => TX_HASH),
): BroadcasterSession => {
  const quote = selected();
  return {
    discover: vi.fn(async () => quote),
    assertQuoteStillCurrent: vi.fn(() => quote),
    prepareSubmission: vi.fn(async () => ({ send })),
    submitPrepared: vi.fn(async (prepared: PreparedBroadcasterSubmission) =>
      prepared.send(),
    ),
  } as unknown as BroadcasterSession;
};

beforeEach(() => {
  walletMocks.calculateFee.mockReturnValue({
    tokenAddress: "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
    amount: 500n,
  });
  walletMocks.estimate.mockResolvedValue({ gasEstimate: 100_000n });
  walletMocks.generateProof.mockResolvedValue(undefined);
  walletMocks.populate.mockResolvedValue({
    transaction: { to: PROXY, data: "0x1234", value: 0n },
    nullifiers: [NULLIFIER],
    preTransactionPOIsPerTxidLeafPerList: {},
  });
  rpcMocks.readGas.mockResolvedValue({ gasPrice: 2n, providerAgreement: 2 });
  rpcMocks.readReceipt.mockResolvedValue(undefined);
});

afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true })));
});

describe("Broadcaster transfer lifecycle", () => {
  it("requires a positive uint256 fee ceiling and rejects a quote above it", () => {
    expect(parseBroadcasterFeeLimit("1000")).toBe(1_000n);
    expect(() => parseBroadcasterFeeLimit("0")).toThrow(/positive/);
    expect(() => parseBroadcasterFeeLimit((2n ** 256n).toString())).toThrow(/uint256/);
    expect(() => assertBroadcasterFeeWithinLimit(1_001n, 1_000n)).toThrow(
      /exceeds/,
    );
    expect(() => assertBroadcasterFeeWithinLimit(0n, 1_000n)).toThrow(/zero/);
  });

  it("generates and validates a proof without reserving or sending in prepare mode", async () => {
    const { config, engine, request } = await testContext();
    const session = fakeSession();
    const result = await sendBroadcasterTransfer({
      config,
      engine,
      session,
      request,
      dbEncryptionKey: "11".repeat(32),
      maxBroadcasterFeeAtomic: "1000",
      requestSource: "http://127.0.0.1/request.json",
      expectedMerchantSigner: request.expectedMerchantSigner,
      submit: false,
    });

    expect(result).toMatchObject({
      receiptStatus: "NOT_SUBMITTED",
      broadcasterFeeAmountAtomic: "500",
    });
    expect(session.prepareSubmission).not.toHaveBeenCalled();
    expect(session.submitPrepared).not.toHaveBeenCalled();
    await expect(
      new SubmissionJournal(submissionJournalPath(config.storage.walletStatePath)).get(
        request.id,
      ),
    ).resolves.toBeUndefined();
  });

  it("durably reserves nullifiers before Waku submission", async () => {
    const { config, engine, request } = await testContext();
    const journal = new SubmissionJournal(
      submissionJournalPath(config.storage.walletStatePath),
    );
    const submit = vi.fn(async () => {
      await expect(journal.get(request.id)).resolves.toMatchObject({
        status: "SUBMITTING",
        submissionMode: "BROADCASTER",
        nullifiers: [NULLIFIER],
      });
      return TX_HASH;
    });
    const result = await sendBroadcasterTransfer({
      config,
      engine,
      session: fakeSession(submit),
      request,
      dbEncryptionKey: "11".repeat(32),
      maxBroadcasterFeeAtomic: "1000",
      requestSource: "http://127.0.0.1/request.json",
      expectedMerchantSigner: request.expectedMerchantSigner,
      submit: true,
    });

    expect(result.receiptStatus).toBe("PENDING");
    expect(submit).toHaveBeenCalledOnce();
    await expect(journal.get(request.id)).resolves.toMatchObject({
      status: "SUBMITTED",
      reportedTransactionHash: TX_HASH,
      transactionHash: TX_HASH,
    });
  });

  it("keeps a reported hash non-canonical until nullifier recovery succeeds", async () => {
    const { config, engine, request } = await testContext();
    vi.mocked(engine.recoverTransactionHashForNullifiers).mockResolvedValue(undefined);
    const result = await sendBroadcasterTransfer({
      config,
      engine,
      session: fakeSession(),
      request,
      dbEncryptionKey: "11".repeat(32),
      maxBroadcasterFeeAtomic: "1000",
      requestSource: "http://127.0.0.1/request.json",
      expectedMerchantSigner: request.expectedMerchantSigner,
      submit: true,
    });

    expect(result).toMatchObject({
      receiptStatus: "PENDING",
      reportedTransactionHash: TX_HASH,
      canonicalTransactionHashResolved: false,
    });
    expect(result.transactionHash).toBeUndefined();
    expect(rpcMocks.readReceipt).not.toHaveBeenCalled();
    const reserved = await new SubmissionJournal(
      submissionJournalPath(config.storage.walletStatePath),
    ).get(request.id);
    expect(reserved).toMatchObject({
      status: "SUBMITTING",
      reportedTransactionHash: TX_HASH,
    });
    expect(reserved?.transactionHash).toBeUndefined();
  });

  it("uses the nullifier-derived hash instead of a conflicting Broadcaster response", async () => {
    const { config, engine, request } = await testContext();
    vi.mocked(engine.recoverTransactionHashForNullifiers).mockResolvedValue(
      CANONICAL_TX_HASH,
    );
    rpcMocks.readReceipt.mockResolvedValue({
      transactionHash: CANONICAL_TX_HASH,
      blockNumber: 123_456,
      blockHash: `0x${"aa".repeat(32)}`,
      succeeded: true,
      providerAgreement: 2,
    });
    const result = await sendBroadcasterTransfer({
      config,
      engine,
      session: fakeSession(),
      request,
      dbEncryptionKey: "11".repeat(32),
      maxBroadcasterFeeAtomic: "1000",
      requestSource: "http://127.0.0.1/request.json",
      expectedMerchantSigner: request.expectedMerchantSigner,
      submit: true,
    });

    expect(result).toMatchObject({
      receiptStatus: "MINED",
      reportedTransactionHash: TX_HASH,
      transactionHash: CANONICAL_TX_HASH,
      canonicalTransactionHashResolved: true,
    });
    expect(rpcMocks.readReceipt).toHaveBeenCalledWith(config, CANONICAL_TX_HASH);
    await expect(
      new SubmissionJournal(submissionJournalPath(config.storage.walletStatePath)).get(
        request.id,
      ),
    ).resolves.toMatchObject({
      status: "MINED",
      reportedTransactionHash: TX_HASH,
      transactionHash: CANONICAL_TX_HASH,
    });
  });

  it("does not reserve when local Broadcaster message preparation fails", async () => {
    const { config, engine, request } = await testContext();
    const session = fakeSession();
    vi.mocked(session.prepareSubmission).mockRejectedValue(
      new SafeFailure("BROADCASTER_SUBMISSION_FAILED", "local preparation failed"),
    );
    await expect(
      sendBroadcasterTransfer({
        config,
        engine,
        session,
        request,
        dbEncryptionKey: "11".repeat(32),
        maxBroadcasterFeeAtomic: "1000",
        requestSource: "http://127.0.0.1/request.json",
        expectedMerchantSigner: request.expectedMerchantSigner,
        submit: true,
      }),
    ).rejects.toMatchObject({ code: "BROADCASTER_SUBMISSION_FAILED" });
    await expect(
      new SubmissionJournal(submissionJournalPath(config.storage.walletStatePath)).get(
        request.id,
      ),
    ).resolves.toBeUndefined();
  });

  it("leaves an ambiguous Waku failure reserved and non-retriable", async () => {
    const { config, engine, request } = await testContext();
    const submit = vi.fn(async () => {
      throw new SafeFailure("BROADCASTER_SUBMISSION_FAILED", "ambiguous");
    });
    await expect(
      sendBroadcasterTransfer({
        config,
        engine,
        session: fakeSession(submit),
        request,
        dbEncryptionKey: "11".repeat(32),
        maxBroadcasterFeeAtomic: "1000",
        requestSource: "http://127.0.0.1/request.json",
        expectedMerchantSigner: request.expectedMerchantSigner,
        submit: true,
      }),
    ).rejects.toMatchObject({ code: "BROADCASTER_SUBMISSION_FAILED" });
    const reserved = await new SubmissionJournal(
      submissionJournalPath(config.storage.walletStatePath),
    ).get(request.id);
    expect(reserved).toMatchObject({
      status: "SUBMITTING",
    });
    expect(reserved?.transactionHash).toBeUndefined();
  });
});
