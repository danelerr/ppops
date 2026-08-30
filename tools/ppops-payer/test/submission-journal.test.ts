import { mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { PaymentRequest } from "../src/request.js";
import {
  SubmissionJournal,
  submissionJournalPath,
} from "../src/security/submission-journal.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true })));
});

const request = (): PaymentRequest => ({
  id: `pi_${"12".repeat(16)}`,
  chainId: 42_161,
  tokenAddress: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  tokenSymbol: "USDC",
  decimals: 6,
  amountAtomic: "100000",
  amountFormatted: "0.1",
  receivedAmountAtomic: "0",
  pendingAmountAtomic: "0",
  status: "OPEN",
  expiresAt: 2_000_000_000,
  rail: "railgun",
  recipient: `0zk${"a".repeat(80)}`,
  memo: `ppops:v1:0x${"ab".repeat(32)}`,
  expectedMerchantSigner: `0x${"11".repeat(20)}`,
  descriptor: {
    version: 1,
    chainId: 42_161,
    rail: "railgun",
    tokenAddress: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    decimals: 6,
    amountAtomic: "100000",
    recipient0zk: `0zk${"a".repeat(80)}`,
    reference: `0x${"ab".repeat(32)}`,
    expiresAt: 2_000_000_000,
    nonce: `0x${"cd".repeat(32)}`,
    merchantSigner: `0x${"11".repeat(20)}`,
    signature: `0x${"ef".repeat(65)}`,
  },
});

describe("payer submission journal", () => {
  it("persists a write-ahead reservation and blocks intent reuse", async () => {
    const root = await mkdtemp(join(tmpdir(), "ppops-payer-journal-"));
    roots.push(root);
    const path = submissionJournalPath(join(root, "wallet-state.json"));
    const journal = new SubmissionJournal(path);
    const payment = request();
    const transactionHash = `0x${"33".repeat(32)}`;
    await journal.reserve(payment, `0x${"22".repeat(20)}`, transactionHash, 7, 1_000);

    await expect(journal.assertUnused(payment.id)).rejects.toMatchObject({
      code: "SUBMISSION_ALREADY_RECORDED",
    });
    expect(await journal.get(payment.id)).toMatchObject({
      status: "SUBMITTING",
      createdAt: 1_000,
      nonce: 7,
      transactionHash,
    });
    const contents = await readFile(path, "utf8");
    expect(contents).not.toContain(payment.memo);
    expect(contents).not.toContain(payment.descriptor.reference);
    expect(contents).not.toContain(payment.descriptor.signature);
    if (process.platform !== "win32") {
      expect((await stat(path)).mode & 0o777).toBe(0o600);
    }
  });

  it("records the public transaction hash after submission", async () => {
    const root = await mkdtemp(join(tmpdir(), "ppops-payer-journal-"));
    roots.push(root);
    const journal = new SubmissionJournal(join(root, "submissions.json"));
    const payment = request();
    const transactionHash = `0x${"33".repeat(32)}`;
    await journal.reserve(payment, `0x${"22".repeat(20)}`, transactionHash, 7, 1_000);
    await journal.markSubmitted(payment.id, transactionHash, 1_001);
    await expect(journal.get(payment.id)).resolves.toMatchObject({
      status: "SUBMITTED",
      transactionHash,
      updatedAt: 1_001,
    });
    await journal.markMined(payment.id, 123_456, true, 1_002);
    await expect(journal.get(payment.id)).resolves.toMatchObject({
      status: "MINED",
      blockNumber: 123_456,
      transactionHash,
      updatedAt: 1_002,
    });
  });

  it("records a reverted receipt without allowing intent reuse", async () => {
    const root = await mkdtemp(join(tmpdir(), "ppops-payer-journal-"));
    roots.push(root);
    const journal = new SubmissionJournal(join(root, "submissions.json"));
    const payment = request();
    const transactionHash = `0x${"44".repeat(32)}`;
    await journal.reserve(payment, `0x${"22".repeat(20)}`, transactionHash, 8, 1_000);
    await journal.markSubmitted(payment.id, transactionHash, 1_001);
    await journal.markMined(payment.id, 123_457, false, 1_002);
    await expect(journal.get(payment.id)).resolves.toMatchObject({
      status: "REVERTED",
      blockNumber: 123_457,
      transactionHash,
    });
    await expect(journal.assertUnused(payment.id)).rejects.toMatchObject({
      code: "SUBMISSION_ALREADY_RECORDED",
    });
  });

  it("persists a recoverable Broadcaster reservation before any transaction hash", async () => {
    const root = await mkdtemp(join(tmpdir(), "ppops-payer-journal-"));
    roots.push(root);
    const path = join(root, "submissions.json");
    const journal = new SubmissionJournal(path);
    const payment = request();
    const broadcaster =
      "0zk1qyjyhqjdkqd9qxusgj092ppxl92plvrk3s3cna9u73h5rwt0ghxvfrv7j6fe3z53l7lrzyqw5te7ku5v8fsrpeadzvpkudgawjv9dg08htj7z3mph5kd6dw50jc";
    const nullifier = `0x${"77".repeat(32)}`;

    await journal.reserveBroadcaster(
      payment,
      {
        payerRailgunAddress: broadcaster,
        broadcasterRailgunAddress: broadcaster,
        broadcasterQuoteFingerprint: "aa".repeat(32),
        broadcasterFeesID: "fee-quote-private-id",
        broadcasterFeeAmountAtomic: 1_000n,
        nullifiers: [nullifier],
      },
      1_000,
    );
    const reserved = await journal.get(payment.id);
    expect(reserved).toMatchObject({
      submissionMode: "BROADCASTER",
      status: "SUBMITTING",
      payerRailgunAddress: broadcaster,
      broadcasterRailgunAddress: broadcaster,
      broadcasterQuoteFingerprint: "aa".repeat(32),
      broadcasterFeeAmountAtomic: "1000",
      nullifiers: [nullifier],
    });
    expect(reserved?.transactionHash).toBeUndefined();
    const contents = await readFile(path, "utf8");
    expect(contents).not.toContain("fee-quote-private-id");
    expect(contents).not.toContain(payment.memo);

    const reportedTransactionHash = `0x${"44".repeat(32)}`;
    const transactionHash = `0x${"55".repeat(32)}`;
    await journal.markBroadcasterReported(
      payment.id,
      reportedTransactionHash,
      1_001,
    );
    await expect(journal.get(payment.id)).resolves.toMatchObject({
      status: "SUBMITTING",
      reportedTransactionHash,
    });
    await journal.markSubmitted(payment.id, transactionHash, 1_002);
    await journal.markMined(payment.id, 123_458, true, 1_003);
    await expect(journal.get(payment.id)).resolves.toMatchObject({
      status: "MINED",
      reportedTransactionHash,
      transactionHash,
      blockNumber: 123_458,
    });
  });

  it("does not allow terminal journal states to move backwards", async () => {
    const root = await mkdtemp(join(tmpdir(), "ppops-payer-journal-"));
    roots.push(root);
    const journal = new SubmissionJournal(join(root, "submissions.json"));
    const payment = request();
    const transactionHash = `0x${"66".repeat(32)}`;
    await journal.reserve(payment, `0x${"22".repeat(20)}`, transactionHash, 9, 1_000);
    await journal.markSubmitted(payment.id, transactionHash, 1_001);
    await journal.markMined(payment.id, 123_459, true, 1_002);
    await expect(journal.markSubmitted(payment.id, transactionHash, 1_003)).rejects.toThrow(
      /submitting/,
    );
    await expect(journal.markMined(payment.id, 123_460, true, 1_004)).rejects.toThrow(
      /submitted/,
    );
  });

  it("rejects zero fees and duplicate Broadcaster nullifiers in durable state", async () => {
    const root = await mkdtemp(join(tmpdir(), "ppops-payer-journal-"));
    roots.push(root);
    const journal = new SubmissionJournal(join(root, "submissions.json"));
    const payment = request();
    const broadcaster =
      "0zk1qyjyhqjdkqd9qxusgj092ppxl92plvrk3s3cna9u73h5rwt0ghxvfrv7j6fe3z53l7lrzyqw5te7ku5v8fsrpeadzvpkudgawjv9dg08htj7z3mph5kd6dw50jc";
    const nullifier = `0x${"77".repeat(32)}`;
    const reservation = {
      payerRailgunAddress: broadcaster,
      broadcasterRailgunAddress: broadcaster,
      broadcasterQuoteFingerprint: "aa".repeat(32),
      broadcasterFeesID: "fee-id",
      broadcasterFeeAmountAtomic: 1n,
      nullifiers: [nullifier],
    };

    await expect(
      journal.reserveBroadcaster(payment, {
        ...reservation,
        broadcasterFeeAmountAtomic: 0n,
      }),
    ).rejects.toThrow();
    await expect(
      journal.reserveBroadcaster(payment, {
        ...reservation,
        nullifiers: [nullifier, nullifier],
      }),
    ).rejects.toThrow(/unique/);
    await expect(journal.get(payment.id)).resolves.toBeUndefined();
  });

  it("blocks nullifier reuse across unresolved intents", async () => {
    const root = await mkdtemp(join(tmpdir(), "ppops-payer-journal-"));
    roots.push(root);
    const journal = new SubmissionJournal(join(root, "submissions.json"));
    const first = request();
    const second = {
      ...request(),
      id: `pi_${"34".repeat(16)}`,
    };
    const broadcaster =
      "0zk1qyjyhqjdkqd9qxusgj092ppxl92plvrk3s3cna9u73h5rwt0ghxvfrv7j6fe3z53l7lrzyqw5te7ku5v8fsrpeadzvpkudgawjv9dg08htj7z3mph5kd6dw50jc";
    const reservation = {
      payerRailgunAddress: broadcaster,
      broadcasterRailgunAddress: broadcaster,
      broadcasterQuoteFingerprint: "aa".repeat(32),
      broadcasterFeesID: "fee-id",
      broadcasterFeeAmountAtomic: 1n,
      nullifiers: [`0x${"77".repeat(32)}`],
    };

    await journal.reserveBroadcaster(first, reservation);
    await expect(
      journal.reserveBroadcaster(second, {
        ...reservation,
        broadcasterQuoteFingerprint: "bb".repeat(32),
      }),
    ).rejects.toMatchObject({ code: "SUBMISSION_ALREADY_RECORDED" });
    await expect(journal.get(second.id)).resolves.toBeUndefined();
  });

  it("allows only bounded same-request retries with the exact reserved nullifiers", async () => {
    const root = await mkdtemp(join(tmpdir(), "ppops-payer-journal-"));
    roots.push(root);
    const journal = new SubmissionJournal(join(root, "submissions.json"));
    const payment = request();
    const broadcaster =
      "0zk1qyjyhqjdkqd9qxusgj092ppxl92plvrk3s3cna9u73h5rwt0ghxvfrv7j6fe3z53l7lrzyqw5te7ku5v8fsrpeadzvpkudgawjv9dg08htj7z3mph5kd6dw50jc";
    const nullifier = `0x${"77".repeat(32)}`;
    const reservation = {
      payerRailgunAddress: broadcaster,
      broadcasterRailgunAddress: broadcaster,
      broadcasterQuoteFingerprint: "aa".repeat(32),
      broadcasterFeesID: "fee-id",
      broadcasterFeeAmountAtomic: 1n,
      nullifiers: [nullifier],
    };

    await journal.reserveBroadcaster(payment, reservation);
    await expect(
      journal.assertBroadcasterRetryable(payment, broadcaster),
    ).resolves.toMatchObject({ status: "SUBMITTING" });
    await expect(
      journal.reserveBroadcasterRetry(payment, {
        ...reservation,
        broadcasterQuoteFingerprint: "bb".repeat(32),
        broadcasterFeesID: "retry-fee-id",
        broadcasterFeeAmountAtomic: 2n,
        nullifiers: [`0x${"88".repeat(32)}`],
      }),
    ).rejects.toMatchObject({ code: "SUBMISSION_ALREADY_RECORDED" });

    await journal.reserveBroadcasterRetry(payment, {
      ...reservation,
      broadcasterQuoteFingerprint: "cc".repeat(32),
      broadcasterFeesID: "retry-fee-id",
      broadcasterFeeAmountAtomic: 2n,
    });
    await journal.markBroadcasterRetryRejected(
      payment.id,
      "cc".repeat(32),
      "POI_INVALID",
    );
    await expect(journal.get(payment.id)).resolves.toMatchObject({
      status: "SUBMITTING",
      broadcasterRetryAttempts: [
        {
          broadcasterQuoteFingerprint: "cc".repeat(32),
          broadcasterFeeAmountAtomic: "2",
          outcome: "REJECTED",
          rejectionCode: "POI_INVALID",
        },
      ],
    });

    for (const fingerprint of ["dd".repeat(32), "ee".repeat(32)]) {
      await journal.reserveBroadcasterRetry(payment, {
        ...reservation,
        broadcasterQuoteFingerprint: fingerprint,
        broadcasterFeesID: `retry-${fingerprint.slice(0, 2)}`,
        broadcasterFeeAmountAtomic: 2n,
      });
      await journal.markBroadcasterRetryRejected(
        payment.id,
        fingerprint,
        "POI_INVALID",
      );
    }
    await expect(
      journal.assertBroadcasterRetryable(payment, broadcaster),
    ).rejects.toMatchObject({ code: "SUBMISSION_ALREADY_RECORDED" });
    await expect(
      journal.reserveBroadcasterRetry(payment, {
        ...reservation,
        broadcasterQuoteFingerprint: "ff".repeat(32),
        broadcasterFeesID: "retry-over-limit",
      }),
    ).rejects.toMatchObject({ code: "SUBMISSION_ALREADY_RECORDED" });
  });

  it("records a definitive fresh rejection without claiming an on-chain hash", async () => {
    const root = await mkdtemp(join(tmpdir(), "ppops-payer-journal-"));
    roots.push(root);
    const journal = new SubmissionJournal(join(root, "submissions.json"));
    const payment = request();
    const broadcaster =
      "0zk1qyjyhqjdkqd9qxusgj092ppxl92plvrk3s3cna9u73h5rwt0ghxvfrv7j6fe3z53l7lrzyqw5te7ku5v8fsrpeadzvpkudgawjv9dg08htj7z3mph5kd6dw50jc";
    await journal.reserveBroadcaster(payment, {
      payerRailgunAddress: broadcaster,
      broadcasterRailgunAddress: broadcaster,
      broadcasterQuoteFingerprint: "aa".repeat(32),
      broadcasterFeesID: "fee-id",
      broadcasterFeeAmountAtomic: 1n,
      nullifiers: [`0x${"77".repeat(32)}`],
    });

    await journal.markRejected(payment.id, "BAD_TOKEN_FEE", 1_001);
    const rejected = await journal.get(payment.id);
    expect(rejected).toMatchObject({
      status: "REJECTED",
      rejectionCode: "BAD_TOKEN_FEE",
    });
    expect(rejected?.transactionHash).toBeUndefined();
    expect(rejected?.reportedTransactionHash).toBeUndefined();
    await expect(journal.assertUnused(payment.id)).rejects.toMatchObject({
      code: "SUBMISSION_ALREADY_RECORDED",
    });
  });

  it("records only a stable category for an ambiguous Broadcaster response", async () => {
    const root = await mkdtemp(join(tmpdir(), "ppops-payer-journal-"));
    roots.push(root);
    const journal = new SubmissionJournal(join(root, "submissions.json"));
    const payment = request();
    const broadcaster =
      "0zk1qyjyhqjdkqd9qxusgj092ppxl92plvrk3s3cna9u73h5rwt0ghxvfrv7j6fe3z53l7lrzyqw5te7ku5v8fsrpeadzvpkudgawjv9dg08htj7z3mph5kd6dw50jc";
    await journal.reserveBroadcaster(payment, {
      payerRailgunAddress: broadcaster,
      broadcasterRailgunAddress: broadcaster,
      broadcasterQuoteFingerprint: "aa".repeat(32),
      broadcasterFeesID: "fee-id",
      broadcasterFeeAmountAtomic: 1n,
      nullifiers: [`0x${"77".repeat(32)}`],
    });

    await journal.markBroadcasterAmbiguous(
      payment.id,
      "TRANSACTION_SEND_RPC_ERROR",
    );
    await expect(journal.get(payment.id)).resolves.toMatchObject({
      status: "SUBMITTING",
      broadcasterAmbiguityCodes: ["TRANSACTION_SEND_RPC_ERROR"],
    });
  });

  it("rejects an impossible canonical hash in a submitting Broadcaster record", async () => {
    const root = await mkdtemp(join(tmpdir(), "ppops-payer-journal-"));
    roots.push(root);
    const path = join(root, "submissions.json");
    const broadcaster =
      "0zk1qyjyhqjdkqd9qxusgj092ppxl92plvrk3s3cna9u73h5rwt0ghxvfrv7j6fe3z53l7lrzyqw5te7ku5v8fsrpeadzvpkudgawjv9dg08htj7z3mph5kd6dw50jc";
    await writeFile(
      path,
      JSON.stringify({
        schemaVersion: 1,
        records: [
          {
            intentId: request().id,
            requestFingerprint: "aa".repeat(32),
            submissionMode: "BROADCASTER",
            payerRailgunAddress: broadcaster,
            broadcasterRailgunAddress: broadcaster,
            broadcasterQuoteFingerprint: "bb".repeat(32),
            broadcasterFeesIDFingerprint: "cc".repeat(32),
            broadcasterFeeAmountAtomic: "1",
            nullifiers: [`0x${"77".repeat(32)}`],
            status: "SUBMITTING",
            transactionHash: `0x${"88".repeat(32)}`,
            createdAt: 1_000,
            updatedAt: 1_000,
          },
        ],
      }),
      { mode: 0o600 },
    );

    await expect(new SubmissionJournal(path).get(request().id)).rejects.toThrow(
      /canonical hash/,
    );
  });

  it("rejects a symlinked journal", async () => {
    if (process.platform === "win32") return;
    const root = await mkdtemp(join(tmpdir(), "ppops-payer-journal-"));
    roots.push(root);
    const target = join(root, "target.json");
    const linked = join(root, "linked.json");
    await writeFile(target, JSON.stringify({ schemaVersion: 1, records: [] }), {
      mode: 0o600,
    });
    await symlink(target, linked);
    await expect(new SubmissionJournal(linked).get(request().id)).rejects.toThrow(
      /non-symlink/,
    );
  });
});
