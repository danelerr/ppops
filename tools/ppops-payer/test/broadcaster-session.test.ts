import type { SelectedBroadcaster } from "@railgun-community/shared-models";
import { describe, expect, it } from "vitest";

import {
  selectCurrentBroadcaster,
  validateBroadcaster,
} from "../src/broadcaster/session.js";

const BROADCASTER_ADDRESS =
  "0zk1qyjyhqjdkqd9qxusgj092ppxl92plvrk3s3cna9u73h5rwt0ghxvfrv7j6fe3z53l7lrzyqw5te7ku5v8fsrpeadzvpkudgawjv9dg08htj7z3mph5kd6dw50jc";
const USDC = "0xaf88d065e77c8cc2239327c5edb3a432268e5831";

const quote = (overrides: Partial<SelectedBroadcaster> = {}): SelectedBroadcaster => ({
  railgunAddress: BROADCASTER_ADDRESS,
  tokenAddress: USDC,
  tokenFee: {
    feePerUnitGas: "0x1000000000000",
    expiration: 1_100_000,
    feesID: "fee-quote-1",
    availableWallets: 2,
    relayAdapt: "false",
    reliability: 0.9,
  },
  ...overrides,
});

describe("Broadcaster quote validation", () => {
  it("accepts a live native-USDC quote and fingerprints its identity", () => {
    const validated = validateBroadcaster(quote(), 0.75, 60_000, 1_000_000);
    expect(validated.feePerUnitGas).toBe(BigInt("0x1000000000000"));
    expect(validated.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects stale, unreliable and wrong-token quotes", () => {
    expect(() =>
      validateBroadcaster(
        quote({ tokenFee: { ...quote().tokenFee, expiration: 1_010_000 } }),
        0.75,
        60_000,
        1_000_000,
      ),
    ).toThrow(/invalid/);
    expect(() =>
      validateBroadcaster(
        quote({ tokenFee: { ...quote().tokenFee, reliability: 0.5 } }),
        0.75,
        60_000,
        1_000_000,
      ),
    ).toThrow(/invalid/);
    expect(() =>
      validateBroadcaster(
        quote({ tokenAddress: "0x0000000000000000000000000000000000000001" }),
        0.75,
        60_000,
        1_000_000,
      ),
    ).toThrow(/invalid/);
  });

  it("rejects malformed external quote objects with a bounded failure", () => {
    for (const malformed of [undefined, {}, { tokenFee: {} }]) {
      expect(() =>
        validateBroadcaster(malformed, 0.75, 60_000, 1_000_000),
      ).toThrow(/malformed/);
    }
  });

  it("matches the complete quote fingerprint and ignores malformed candidates", () => {
    const expected = validateBroadcaster(quote(), 0.75, 60_000, 1_000_000);
    expect(
      selectCurrentBroadcaster(
        [{ tokenFee: {} }, quote()],
        expected,
        0.75,
        60_000,
        1_000_000,
      )?.fingerprint,
    ).toBe(expected.fingerprint);
    expect(
      selectCurrentBroadcaster(
        [
          quote({
            tokenFee: { ...quote().tokenFee, expiration: 1_200_000 },
          }),
        ],
        expected,
        0.75,
        60_000,
        1_000_000,
      ),
    ).toBeUndefined();
  });
});
