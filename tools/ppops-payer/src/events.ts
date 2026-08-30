import { writeSync } from "node:fs";

type EventValue = string | number | boolean | null | undefined;

export const writeEvent = (
  event: string,
  fields: Record<string, EventValue> = {},
): void => {
  writeSync(
    process.stderr.fd,
    `${JSON.stringify({
      event,
      at: Math.floor(Date.now() / 1_000),
      ...Object.fromEntries(
        Object.entries(fields).filter(([, value]) => value !== undefined),
      ),
    })}\n`,
  );
};

export type SafeFailureCode =
  | "CONFIG_INVALID"
  | "SECRET_INVALID"
  | "REQUEST_INVALID"
  | "ENGINE_START_FAILED"
  | "ENGINE_STOP_FAILED"
  | "SYNC_FAILED"
  | "POI_NOT_READY"
  | "POI_FAILED"
  | "BROADCASTER_CONFIG_INVALID"
  | "BROADCASTER_UNAVAILABLE"
  | "BROADCASTER_INVALID_QUOTE"
  | "BROADCASTER_FEE_LIMIT_EXCEEDED"
  | "BROADCASTER_REJECTED"
  | "BROADCASTER_SUBMISSION_FAILED"
  | "INSUFFICIENT_PRIVATE_BALANCE"
  | "INSUFFICIENT_GAS_BALANCE"
  | "GAS_LIMIT_EXCEEDED"
  | "RPC_UNAVAILABLE"
  | "PROOF_FAILED"
  | "POPULATE_FAILED"
  | "SUBMISSION_ALREADY_RECORDED"
  | "SUBMISSION_FAILED"
  | "JOURNAL_UPDATE_FAILED"
  | "RECEIPT_UNAVAILABLE"
  | "TRANSACTION_REVERTED"
  | "TRANSACTION_REPLACED"
  | "INTERNAL_ERROR";

export class SafeFailure extends Error {
  constructor(
    readonly code: SafeFailureCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "SafeFailure";
  }
}

export const safeFailureResult = (error: unknown): { ok: false; error: { code: SafeFailureCode } } => ({
  ok: false,
  error: {
    code: error instanceof SafeFailure ? error.code : "INTERNAL_ERROR",
  },
});
