export type SafeCliFailureCode =
  | "INVALID_ARGUMENT"
  | "INVALID_INPUT"
  | "FILE_UNAVAILABLE"
  | "CONFIG_INVALID"
  | "PREFLIGHT_FAILED"
  | "RECOVERY_FAILED"
  | "RUNTIME_FAILED";

const systemCode = (error: unknown): string =>
  error instanceof Error
    ? String((error as NodeJS.ErrnoException).code ?? "").toUpperCase()
    : "";

export const classifyCliFailure = (error: unknown): SafeCliFailureCode => {
  if (!(error instanceof Error)) return "RUNTIME_FAILED";
  if (error.constructor.name === "ZodError" || error instanceof SyntaxError) {
    return "INVALID_INPUT";
  }
  if (["EACCES", "ENOENT", "EPERM", "EISDIR", "ENOTDIR"].includes(systemCode(error))) {
    return "FILE_UNAVAILABLE";
  }
  const message = error.message.toLowerCase();
  if (
    message.includes("unsupported option") ||
    message.includes("missing required option") ||
    message.includes("unknown command") ||
    message.includes("does not take a value") ||
    message.includes("may be specified only once")
  ) {
    return "INVALID_ARGUMENT";
  }
  if (
    message.includes("config") ||
    message.includes("secret") ||
    message.includes("viewing key") ||
    message.includes("private file") ||
    message.includes("wallet identity")
  ) {
    return "CONFIG_INVALID";
  }
  if (
    message.includes("preflight") ||
    message.includes("rpc") ||
    message.includes("ppoi") ||
    message.includes("provider")
  ) {
    return "PREFLIGHT_FAILED";
  }
  if (
    message.includes("backup") ||
    message.includes("restore") ||
    message.includes("recovery")
  ) {
    return "RECOVERY_FAILED";
  }
  return "RUNTIME_FAILED";
};

export const safeCliFailureResult = (
  error: unknown,
): { ok: false; error: { code: SafeCliFailureCode } } => ({
  ok: false,
  error: { code: classifyCliFailure(error) },
});
