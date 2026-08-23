import { describe, expect, it, vi } from "vitest";

import { preflightPPOINodes } from "../src/railgun/ppoi-preflight.js";

const healthResponse = () =>
  new Response(
    JSON.stringify({ jsonrpc: "2.0", result: "OK", id: "ppops-preflight" }),
    { status: 200, headers: { "content-type": "application/json" } },
  );

describe("PPOI preflight", () => {
  it("requires at least one healthy node and sends the official health method", async () => {
    const fakeFetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.redirect).toBe("error");
      expect(JSON.parse(String(init?.body))).toMatchObject({
        jsonrpc: "2.0",
        method: "ppoi_health",
        params: {},
        id: "ppops-preflight",
      });
      return healthResponse();
    }) as unknown as typeof fetch;
    await expect(
      preflightPPOINodes(["https://poi.example"], 1_000, fakeFetch),
    ).resolves.toEqual({ configuredNodeCount: 1, healthyNodeCount: 1 });
  });

  it("accepts a healthy fallback without treating malformed responses as healthy", async () => {
    const fakeFetch = vi.fn(async (url: string | URL | Request) =>
      url.toString().includes("healthy")
        ? healthResponse()
        : new Response(JSON.stringify({ jsonrpc: "2.0", result: true, id: 1 })),
    ) as unknown as typeof fetch;
    await expect(
      preflightPPOINodes(
        ["https://invalid.example", "https://healthy.example"],
        1_000,
        fakeFetch,
      ),
    ).resolves.toEqual({ configuredNodeCount: 2, healthyNodeCount: 1 });
  });

  it("fails closed when every node is unavailable or invalid", async () => {
    const fakeFetch = vi.fn(
      async () => new Response("unavailable", { status: 503 }),
    ) as unknown as typeof fetch;
    await expect(
      preflightPPOINodes(["https://poi.example"], 1_000, fakeFetch),
    ).rejects.toThrow("No configured PPOI node passed");
    await expect(preflightPPOINodes([], 1_000, fakeFetch)).rejects.toThrow(
      "requires at least one",
    );
  });

  it("caps streamed response bodies even without a content-length header", async () => {
    const fakeFetch = vi.fn(
      async () =>
        new Response("x".repeat(16_385), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ) as unknown as typeof fetch;
    await expect(
      preflightPPOINodes(["https://poi.example"], 1_000, fakeFetch),
    ).rejects.toThrow("No configured PPOI node passed");
  });
});
