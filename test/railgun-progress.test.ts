import { describe, expect, it } from "vitest";

import { normalizeMerkletreeProgressRatio } from "../src/railgun/engine.js";

describe("RAILGUN scan progress", () => {
  it("preserves the SDK's zero-to-one ratio and clamps invalid values", () => {
    expect(normalizeMerkletreeProgressRatio(0)).toBe(0);
    expect(normalizeMerkletreeProgressRatio(0.5)).toBe(0.5);
    expect(normalizeMerkletreeProgressRatio(1)).toBe(1);
    expect(normalizeMerkletreeProgressRatio(-1)).toBe(0);
    expect(normalizeMerkletreeProgressRatio(50)).toBe(1);
    expect(normalizeMerkletreeProgressRatio(Number.NaN)).toBe(0);
  });
});
