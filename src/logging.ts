type LogValue = string | number | boolean | null | undefined;

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

export const logWarn = (event: string, fields?: Record<string, LogValue>): void =>
  writeLog("warn", event, fields);

export const logError = (event: string, error: unknown): void =>
  writeLog("error", event, {
    errorType: error instanceof Error ? error.constructor.name : "UnknownError",
  });
