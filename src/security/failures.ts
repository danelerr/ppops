export type SafeCliFailureCode =
  | "INVALID_ARGUMENT"
  | "INVALID_INPUT"
  | "FILE_UNAVAILABLE"
  | "CONFIG_INVALID"
  | "PREFLIGHT_FAILED"
  | "RECOVERY_FAILED"
  | "RUNTIME_FAILED";

// Only application-authored text belongs here. Never expose SDK exception text.
export class UsageError extends Error {
  constructor(readonly hint: string, readonly field?: string) {
    super(hint);
    this.name = "UsageError";
  }
}

const hints: Record<SafeCliFailureCode, string> = {
  INVALID_ARGUMENT: "Run ppops <command> --help to check required options and accepted values.",
  INVALID_INPUT: "Check the configuration fields and JSON syntax. See docs/CONFIGURATION.md.",
  FILE_UNAVAILABLE: "Check that the configured file exists and is readable by this process. Run ppops doctor --offline.",
  CONFIG_INVALID: "Run ppops doctor --offline. Config and secrets must be owner-only regular files; check paths and the selected network profile.",
  PREFLIGHT_FAILED: "Run ppops preflight. Check RPC agreement, chain ID, finalized support and PPOI health; keep provider credentials private.",
  RECOVERY_FAILED: "Stop the daemon before backup or restore. Check the backup inventory and available disk space.",
  RUNTIME_FAILED: "Run ppops doctor. Check readiness, the last scan error and whether another process owns the state directory.",
};

const systemCode = (error: unknown): string =>
  error instanceof Error
    ? String((error as NodeJS.ErrnoException).code ?? "").toUpperCase()
    : "";

const classifyCliFailure = (error: unknown): SafeCliFailureCode => {
  if (error instanceof UsageError) return "INVALID_ARGUMENT";
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

export const safeCliFailureResult = (error: unknown) => {
  const code = classifyCliFailure(error);
  const knownFields = new Set(["schemaVersion", "server", "network", "storage", "secrets", "scanner", "webhook", "host", "port", "allowRemote", "rateLimit", "apiPerMinute", "authFailuresPerMinute", "checkoutPerMinute", "railgunNetworkName", "chainId", "tokenAddress", "tokenSymbol", "tokenDecimals", "rpcUrls", "deploymentBlock", "finality", "mode", "confirmations", "sqlitePath", "railgunDbPath", "artifactsPath", "walletStatePath", "apiTokenFile", "merchantSigningKeyFile", "railgunDbEncryptionKeyFile", "viewingKeyFile", "webhookHmacKeyFile", "intervalMs", "poiNodeUrls", "providerPollingIntervalMs", "rpcTimeoutMs", "maxRpcBlockLag", "finalizedRecheckSeconds", "scanStallThresholdMs", "maxScanStalenessMs", "url", "keyId", "timeoutMs", "maxAttempts", "baseRetryMs", "maxRetryMs"]);
  const validationIssues = error instanceof Error && error.constructor.name === "ZodError"
    ? (error as Error & { issues: Array<{ path: PropertyKey[] }> }).issues.map((issue) => ({
      field: issue.path.length && issue.path.every((part) => typeof part === "number" || knownFields.has(String(part))) ? issue.path.join(".") : "configuration",
      hint: "Check this field's type, required value and profile constraints in docs/CONFIGURATION.md.",
    })) : [];
  return {
    ok: false as const,
    error: {
      code,
      hint: error instanceof UsageError ? error.hint : hints[code],
      ...(error instanceof UsageError && error.field ? { field: error.field } : {}),
      ...(validationIssues.length ? { issues: validationIssues } : {}),
    },
  };
};
