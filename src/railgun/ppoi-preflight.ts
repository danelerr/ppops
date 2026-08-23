import { z } from "zod";

const HealthResponseSchema = z
  .object({
    jsonrpc: z.literal("2.0"),
    id: z.literal("ppops-preflight"),
    result: z.literal("OK"),
  })
  .strict();

export type PPOIPreflightResult = {
  configuredNodeCount: number;
  healthyNodeCount: number;
};

export const preflightPPOINodes = async (
  nodeUrls: string[],
  timeoutMs: number,
  fetchImplementation: typeof fetch = fetch,
): Promise<PPOIPreflightResult> => {
  if (nodeUrls.length === 0) {
    throw new Error("PPOI preflight requires at least one configured node");
  }
  const checks = await Promise.allSettled(
    nodeUrls.map(async (url) => {
      const response = await fetchImplementation(url, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "ppoi_health",
          params: {},
          id: "ppops-preflight",
        }),
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw new Error("PPOI health request returned non-success HTTP");
      const contentLength = Number(response.headers.get("content-length") ?? 0);
      if (Number.isFinite(contentLength) && contentLength > 16_384) {
        await response.body?.cancel();
        throw new Error("PPOI health response exceeded the size limit");
      }
      const parsed = HealthResponseSchema.safeParse(
        await response.json().catch(() => undefined),
      );
      if (!parsed.success) throw new Error("PPOI health response was invalid");
    }),
  );
  const healthyNodeCount = checks.filter((check) => check.status === "fulfilled").length;
  if (healthyNodeCount === 0) {
    throw new Error("No configured PPOI node passed the health preflight");
  }
  return { configuredNodeCount: nodeUrls.length, healthyNodeCount };
};
