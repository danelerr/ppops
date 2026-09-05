import { describe, expect, it } from "vitest";

import { classifyWebhookFailure } from "../src/events/webhook.js";
import { safeCliFailureResult } from "../src/security/failures.js";

describe("operational failure redaction", () => {
  it("never serializes CLI exception messages", () => {
    const secretUrl = "https://rpc.example/private-api-key";
    const result = safeCliFailureResult(new Error(`provider failed at ${secretUrl}`));
    expect(result).toMatchObject({ ok: false, error: { code: "PREFLIGHT_FAILED" } });
    expect(result.error.hint).toContain("preflight");
    expect(JSON.stringify(result)).not.toContain(secretUrl);
  });

  it("stores stable webhook failure classes instead of endpoint details", () => {
    expect(classifyWebhookFailure(new Error("Webhook returned HTTP 503"))).toBe(
      "HTTP_5XX",
    );
    expect(
      classifyWebhookFailure(new Error("failure at https://merchant.example/private-key")),
    ).toBe("DELIVERY_FAILED");
  });
});
