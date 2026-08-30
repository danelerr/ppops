type LogValue = string | number | boolean | null | undefined;

export type SafeErrorCode =
  | "TIMEOUT"
  | "CONCURRENT_SCAN"
  | "RPC_RATE_LIMITED"
  | "RPC_QUORUM"
  | "RPC_NETWORK"
  | "STORAGE_LOCKED"
  | "STORAGE_CORRUPT"
  | "PPOI_FAILED"
  | "SCAN_FAILED";

export const classifyError = (error: unknown): SafeErrorCode => {
  if (!(error instanceof Error)) return "SCAN_FAILED";
  const message = error.message.toLowerCase();
  const systemCode = String((error as NodeJS.ErrnoException).code ?? "").toLowerCase();
  if (message.includes("timed out") || systemCode === "etimedout") return "TIMEOUT";
  if (message.includes("already in progress") || message.includes("scan in progress")) {
    return "CONCURRENT_SCAN";
  }
  if (message.includes("429") || message.includes("rate limit")) return "RPC_RATE_LIMITED";
  if (message.startsWith("rpc quorum") || message.startsWith("rpc omitted")) {
    return "RPC_QUORUM";
  }
  if (/\block(?:ed|ing)?\b/.test(message) || systemCode === "eagain" || systemCode === "ebusy") {
    return "STORAGE_LOCKED";
  }
  if (message.includes("corrupt") || message.includes("checksum")) return "STORAGE_CORRUPT";
  if (message.includes("ppoi") || message.includes("proof of innocence")) return "PPOI_FAILED";
  if (
    message.includes("network") ||
    message.includes("fetch") ||
    message.includes("socket") ||
    systemCode === "econnreset" ||
    systemCode === "enotfound"
  ) {
    return "RPC_NETWORK";
  }
  return "SCAN_FAILED";
};

const writeLog = (
  level: "info" | "warn" | "error",
  event: string,
  fields: Record<string, LogValue> = {},
): void => {
  const safeFields = Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  );
  process.stdout.write(
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      event,
      ...safeFields,
    })}\n`,
  );
};

export const logInfo = (event: string, fields?: Record<string, LogValue>): void =>
  writeLog("info", event, fields);

export const logError = (event: string, error: unknown): void =>
  writeLog("error", event, {
    errorType: error instanceof Error ? error.constructor.name : "UnknownError",
    errorCode: classifyError(error),
  });
