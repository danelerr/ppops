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
