import { loadConfig, type PPOpsConfig } from "../config.js";
import { readSecret } from "../security/secrets.js";
import { safeCliFailureResult } from "../security/failures.js";
import { readResponseTextLimited } from "../security/http.js";

type Check = { check: string; ok: boolean; hint: string; code?: string };
export const diagnose = async (args: {
  configPath: string;
  offline?: boolean;
  statusOnly?: boolean;
  preflight: (config: PPOpsConfig) => Promise<unknown>;
  fetch?: typeof fetch;
}) => {
  const checks: Check[] = [];
  const check = async (
    name: string,
    operation: () => Promise<unknown>,
    success: string,
  ) => {
    try {
      await operation();
      checks.push({ check: name, ok: true, hint: success });
      return true;
    } catch (error) {
      checks.push({
        check: name,
        ok: false,
        ...safeCliFailureResult(error).error,
      });
      return false;
    }
  };
  let config: PPOpsConfig | undefined;
  await check(
    "configuration",
    async () => {
      config = await loadConfig(args.configPath);
    },
    "Schema and paths are valid.",
  );
  if (!config)
    return {
      ok: false,
      checks,
      next: "Fix the configuration file, then run doctor --offline again.",
    };
  const resolved = config;
  if (!args.statusOnly) {
    const kinds = {
      apiTokenFile: "api-token",
      merchantSigningKeyFile: "merchant-private-key",
      railgunDbEncryptionKeyFile: "railgun-db-encryption-key",
      viewingKeyFile: "viewing-key",
      webhookHmacKeyFile: "webhook-hmac-key",
    } as const;
    for (const name of Object.keys(kinds) as Array<keyof typeof kinds>) {
      const path = resolved.secrets[name];
      if (path)
        await check(
          `secrets.${name}`,
          () => readSecret(path, kinds[name]),
          "Owner-only file and secret format are valid.",
        );
    }
    if (!args.offline)
      await check(
        "RPC and PPOI",
        () => args.preflight(resolved),
        "Provider quorum and PPOI preflight passed.",
      );
  }
  let health: Record<string, unknown> | undefined;
  if (!args.offline) {
    const host = resolved.server.host === "::1" ? "[::1]" : "127.0.0.1";
    await check(
      "daemon",
      async () => {
        const response = await (args.fetch ?? fetch)(
          `http://${host}:${resolved.server.port}/v1/health`,
          { signal: AbortSignal.timeout(5000), redirect: "error" },
        );
        if (!response.ok) throw new Error("Daemon is unavailable");
        health = JSON.parse(
          await readResponseTextLimited(response, 65536, "Daemon health"),
        ) as Record<string, unknown>;
        if (!health.railgunReady) throw new Error("Daemon is not ready");
      },
      "Daemon completed a recent successful scan.",
    );
  }
  const ok = checks.every((entry) => entry.ok);
  const next = args.offline
    ? "Offline checks do not decode/import the wallet or verify the network. Run preflight, then serve and wait for readiness."
    : health?.scanInProgress
      ? "A scan is running. Wait for progress; keep one process per state directory."
      : ok
        ? "Ready to create payment intents."
        : "Resolve failed checks before accepting payments. See docs/TROUBLESHOOTING.md.";
  return { ok, checks, ...(health ? { health } : {}), next };
};

export const formatDiagnostics = (
  result: Awaited<ReturnType<typeof diagnose>>,
): string =>
  result.checks
    .map(
      (entry) => `${entry.ok ? "PASS" : "FAIL"}  ${entry.check}: ${entry.hint}`,
    )
    .join("\n") +
  (result.health
    ? `\nScan: ${result.health.scanInProgress ? "running" : "idle"}; stalled: ${Boolean(result.health.scanStalled)}; consecutive failures: ${result.health.consecutiveFailures ?? 0}.`
    : "") +
  `\n\n${result.next}\n`;
