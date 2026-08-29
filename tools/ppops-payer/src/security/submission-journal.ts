import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";

import { z } from "zod";

import { SafeFailure } from "../events.js";
import type { PaymentRequest } from "../request.js";
import { readOwnerOnlyFile } from "./private-file.js";

const SubmissionRecordSchema = z
  .object({
    intentId: z.string().regex(/^pi_[0-9a-f]{32}$/),
    requestFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    selfSigner: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    status: z.enum(["SUBMITTING", "SUBMITTED"]),
    createdAt: z.number().int().nonnegative().safe(),
    updatedAt: z.number().int().nonnegative().safe(),
    transactionHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(),
  })
  .strict();

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
      selfSigner,
      status: "SUBMITTING",
      createdAt: now,
      updatedAt: now,
    });
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
