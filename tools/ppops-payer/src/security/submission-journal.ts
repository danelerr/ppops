import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";

import { z } from "zod";
import { validateRailgunAddress } from "@railgun-community/wallet";

import { SafeFailure } from "../events.js";
import type { PaymentRequest } from "../request.js";
import { readOwnerOnlyFile } from "./private-file.js";

const TransactionHashSchema = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const RailgunAddressSchema = z
  .string()
  .regex(/^0zk\S{32,256}$/)
  .refine(validateRailgunAddress, "Invalid RAILGUN address");

const SubmissionRecordSchema = z
  .object({
    intentId: z.string().regex(/^pi_[0-9a-f]{32}$/),
    requestFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    submissionMode: z.enum(["SELF_SIGNED", "BROADCASTER"]).optional(),
    selfSigner: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
    payerRailgunAddress: RailgunAddressSchema.optional(),
    broadcasterRailgunAddress: RailgunAddressSchema.optional(),
    broadcasterQuoteFingerprint: z.string().regex(/^[0-9a-f]{64}$/).optional(),
    broadcasterFeesIDFingerprint: z.string().regex(/^[0-9a-f]{64}$/).optional(),
    broadcasterFeeAmountAtomic: z.string().regex(/^[1-9][0-9]*$/).optional(),
    nullifiers: z.array(TransactionHashSchema).min(1).max(64).optional(),
    reportedTransactionHash: TransactionHashSchema.optional(),
    status: z.enum(["SUBMITTING", "SUBMITTED", "MINED", "REVERTED"]),
    createdAt: z.number().int().nonnegative().safe(),
    updatedAt: z.number().int().nonnegative().safe(),
    nonce: z.number().int().nonnegative().safe().optional(),
    transactionHash: TransactionHashSchema.optional(),
    blockNumber: z.number().int().nonnegative().safe().optional(),
  })
  .strict()
  .superRefine((record, context) => {
    const submissionMode = record.submissionMode ?? "SELF_SIGNED";
    if (submissionMode === "SELF_SIGNED" && !record.selfSigner) {
      context.addIssue({
        code: "custom",
        path: ["selfSigner"],
        message: "Self-signed records require a signer",
      });
    }
    if (submissionMode === "SELF_SIGNED" && !record.transactionHash) {
      context.addIssue({
        code: "custom",
        path: ["transactionHash"],
        message: "Self-signed records require their precomputed transaction hash",
      });
    }
    const broadcasterOnlyFields = [
      record.payerRailgunAddress,
      record.broadcasterRailgunAddress,
      record.broadcasterQuoteFingerprint,
      record.broadcasterFeesIDFingerprint,
      record.broadcasterFeeAmountAtomic,
      record.nullifiers,
      record.reportedTransactionHash,
    ];
    if (
      submissionMode === "SELF_SIGNED" &&
      broadcasterOnlyFields.some((value) => value !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["submissionMode"],
        message: "Self-signed records cannot contain Broadcaster state",
      });
    }
    if (
      submissionMode === "BROADCASTER" &&
      (!record.payerRailgunAddress ||
        !record.broadcasterRailgunAddress ||
        !record.broadcasterQuoteFingerprint ||
        !record.broadcasterFeesIDFingerprint ||
        record.broadcasterFeeAmountAtomic === undefined ||
        !record.nullifiers)
    ) {
      context.addIssue({
        code: "custom",
        path: ["submissionMode"],
        message: "Broadcaster records require quote identity, fee and nullifiers",
      });
    }
    if (
      submissionMode === "BROADCASTER" &&
      (record.selfSigner !== undefined || record.nonce !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["submissionMode"],
        message: "Broadcaster records cannot contain self-signer state",
      });
    }
    if (record.nullifiers) {
      const normalized = record.nullifiers.map((value) => value.toLowerCase());
      if (
        normalized.some((value) => value === `0x${"0".repeat(64)}`) ||
        new Set(normalized).size !== normalized.length
      ) {
        context.addIssue({
          code: "custom",
          path: ["nullifiers"],
          message: "Broadcaster nullifiers must be unique and nonzero",
        });
      }
    }
    if (record.status !== "SUBMITTING" && !record.transactionHash) {
      context.addIssue({
        code: "custom",
        path: ["transactionHash"],
        message: "Submitted records require a transaction hash",
      });
    }
    if (
      submissionMode === "BROADCASTER" &&
      record.status === "SUBMITTING" &&
      record.transactionHash !== undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["transactionHash"],
        message: "Submitting Broadcaster records cannot claim a canonical hash",
      });
    }
    if (
      record.status !== "MINED" &&
      record.status !== "REVERTED" &&
      record.blockNumber !== undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["blockNumber"],
        message: "Only terminal records may contain a block number",
      });
    }
    if (
      (record.status === "MINED" || record.status === "REVERTED") &&
      record.blockNumber === undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["blockNumber"],
        message: "Mined records require a block number",
      });
    }
  });

const SubmissionJournalSchema = z
  .object({
    schemaVersion: z.literal(1),
    records: z.array(SubmissionRecordSchema).max(10_000),
  })
  .strict();

export type SubmissionRecord = z.infer<typeof SubmissionRecordSchema>;
type SubmissionJournalFile = z.infer<typeof SubmissionJournalSchema>;

const emptyJournal = (): SubmissionJournalFile => ({ schemaVersion: 1, records: [] });

const requestFingerprint = (request: PaymentRequest): string =>
  createHash("sha256")
    .update("ppops-payer-request:v1:")
    .update(request.id)
    .update(":")
    .update(request.descriptor.signature)
    .digest("hex");

export const submissionJournalPath = (walletStatePath: string): string =>
  `${walletStatePath}.submissions.json`;

export class SubmissionJournal {
  constructor(readonly path: string) {}

  async get(intentId: string): Promise<SubmissionRecord | undefined> {
    return (await this.read()).records.find((record) => record.intentId === intentId);
  }

  async assertUnused(intentId: string): Promise<void> {
    if (await this.get(intentId)) {
      throw new SafeFailure(
        "SUBMISSION_ALREADY_RECORDED",
        "This intent already has a local submission record",
      );
    }
  }

  async reserve(
    request: PaymentRequest,
    selfSigner: string,
    transactionHash: string,
    nonce: number,
    now = Math.floor(Date.now() / 1_000),
  ): Promise<void> {
    const journal = await this.read();
    if (journal.records.some((record) => record.intentId === request.id)) {
      throw new SafeFailure(
        "SUBMISSION_ALREADY_RECORDED",
        "This intent already has a local submission record",
      );
    }
    journal.records.push({
      intentId: request.id,
      requestFingerprint: requestFingerprint(request),
      submissionMode: "SELF_SIGNED",
      selfSigner,
      status: "SUBMITTING",
      createdAt: now,
      updatedAt: now,
      nonce,
      transactionHash,
    });
    await this.write(journal);
  }

  async reserveBroadcaster(
    request: PaymentRequest,
    input: {
      payerRailgunAddress: string;
      broadcasterRailgunAddress: string;
      broadcasterQuoteFingerprint: string;
      broadcasterFeesID: string;
      broadcasterFeeAmountAtomic: bigint;
      nullifiers: string[];
    },
    now = Math.floor(Date.now() / 1_000),
  ): Promise<void> {
    const journal = await this.read();
    if (journal.records.some((record) => record.intentId === request.id)) {
      throw new SafeFailure(
        "SUBMISSION_ALREADY_RECORDED",
        "This intent already has a local submission record",
      );
    }
    journal.records.push({
      intentId: request.id,
      requestFingerprint: requestFingerprint(request),
      submissionMode: "BROADCASTER",
      payerRailgunAddress: input.payerRailgunAddress,
      broadcasterRailgunAddress: input.broadcasterRailgunAddress,
      broadcasterQuoteFingerprint: input.broadcasterQuoteFingerprint,
      broadcasterFeesIDFingerprint: createHash("sha256")
        .update("ppops-broadcaster-fees-id:v1:")
        .update(input.broadcasterFeesID)
        .digest("hex"),
      broadcasterFeeAmountAtomic: input.broadcasterFeeAmountAtomic.toString(),
      nullifiers: input.nullifiers.map((value) => value.toLowerCase()),
      status: "SUBMITTING",
      createdAt: now,
      updatedAt: now,
    });
    await this.write(journal);
  }

  async markBroadcasterReported(
    intentId: string,
    reportedTransactionHash: string,
    now = Math.floor(Date.now() / 1_000),
  ): Promise<void> {
    const journal = await this.read();
    const index = journal.records.findIndex((record) => record.intentId === intentId);
    const current = journal.records[index];
    if (!current || current.submissionMode !== "BROADCASTER") {
      throw new Error("Broadcaster submission reservation disappeared");
    }
    if (current.status !== "SUBMITTING") {
      throw new Error("Only a submitting Broadcaster transaction may record a reported hash");
    }
    const normalized = TransactionHashSchema.parse(reportedTransactionHash).toLowerCase();
    if (
      current.reportedTransactionHash &&
      current.reportedTransactionHash.toLowerCase() !== normalized
    ) {
      throw new Error("Broadcaster reported a different transaction hash");
    }
    if (current.reportedTransactionHash) return;
    journal.records[index] = {
      ...current,
      reportedTransactionHash: normalized,
      updatedAt: now,
    };
    await this.write(journal);
  }

  async markMined(
    intentId: string,
    blockNumber: number,
    succeeded: boolean,
    now = Math.floor(Date.now() / 1_000),
  ): Promise<void> {
    const journal = await this.read();
    const index = journal.records.findIndex((record) => record.intentId === intentId);
    const current = journal.records[index];
    if (!current?.transactionHash) {
      throw new Error("Submitted transaction record disappeared");
    }
    const targetStatus = succeeded ? "MINED" : "REVERTED";
    if (current.status === targetStatus && current.blockNumber === blockNumber) return;
    if (current.status !== "SUBMITTED") {
      throw new Error("Only a submitted transaction may record a receipt");
    }
    journal.records[index] = {
      ...current,
      status: targetStatus,
      blockNumber,
      updatedAt: now,
    };
    await this.write(journal);
  }

  async markSubmitted(
    intentId: string,
    transactionHash: string,
    now = Math.floor(Date.now() / 1_000),
  ): Promise<void> {
    const journal = await this.read();
    const index = journal.records.findIndex((record) => record.intentId === intentId);
    const current = journal.records[index];
    if (!current) throw new Error("Submission reservation disappeared");
    if (
      current.transactionHash &&
      current.transactionHash.toLowerCase() !== transactionHash.toLowerCase()
    ) {
      throw new Error("Submitted transaction hash differs from reservation");
    }
    if (current.status === "SUBMITTED") return;
    if (current.status !== "SUBMITTING") {
      throw new Error("Only a submitting transaction may become submitted");
    }
    journal.records[index] = {
      ...current,
      status: "SUBMITTED",
      transactionHash,
      updatedAt: now,
    };
    await this.write(journal);
  }

  private async read(): Promise<SubmissionJournalFile> {
    try {
      return SubmissionJournalSchema.parse(
        JSON.parse(
          await readOwnerOnlyFile(this.path, {
            label: "Payer submission journal",
            maxBytes: 2 * 1_024 * 1_024,
          }),
        ) as unknown,
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyJournal();
      throw error;
    }
  }

  private async write(journal: SubmissionJournalFile): Promise<void> {
    const parsed = SubmissionJournalSchema.parse(journal);
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.path}.tmp-${randomUUID()}`;
    try {
      const handle = await open(temporaryPath, "wx", 0o600);
      try {
        await handle.writeFile(`${JSON.stringify(parsed, null, 2)}\n`, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporaryPath, this.path);
      if (process.platform !== "win32") {
        const directoryHandle = await open(dirname(this.path), constants.O_RDONLY);
        try {
          await directoryHandle.sync();
        } finally {
          await directoryHandle.close();
        }
      }
    } catch (error) {
      await unlink(temporaryPath).catch((unlinkError: unknown) => {
        if ((unlinkError as NodeJS.ErrnoException).code !== "ENOENT") throw unlinkError;
      });
      throw error;
    }
  }
}
