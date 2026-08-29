import { Wallet } from "ethers";
import { describe, expect, it } from "vitest";

import {
  assertExpectedPayerAddress,
  assertExpectedSelfSigner,
  assertGasCostWithinLimit,
  parseGasCostLimit,
} from "../src/execution-guards.js";

const PAYER_ADDRESS =
  "0zk1qykzjxctynyz4z43pukckpv43jyzhyvy0ehrd5wuc54l5enqf9qfrrv7j6fe3z53la7enqphqvxys9aqyp9xx0km95ehqslx8apmu8l7anc7emau4tvsultrkvd";

describe("mainnet execution guards", () => {
  it("requires the exact valid payer identity", () => {
    expect(() => assertExpectedPayerAddress(PAYER_ADDRESS, PAYER_ADDRESS)).not.toThrow();
    expect(() => assertExpectedPayerAddress(PAYER_ADDRESS, "0zk-invalid")).toThrow(
      /identity does not match/,
    );
  });

  it("derives and confirms the public self-signer", () => {
    const wallet = Wallet.createRandom();
    expect(assertExpectedSelfSigner(wallet.privateKey, wallet.address)).toBe(wallet.address);
    expect(() =>
      assertExpectedSelfSigner(wallet.privateKey, Wallet.createRandom().address),
    ).toThrow(/identity does not match/);
  });

  it("rejects malformed and uint256-overflowing gas bounds", () => {
    expect(parseGasCostLimit("1000000000000000")).toBe(1_000_000_000_000_000n);
    expect(() => parseGasCostLimit("0")).toThrow(/positive wei/);
    expect(() => parseGasCostLimit((2n ** 256n).toString())).toThrow(/uint256/);
  });

  it("fails closed when estimated maximum gas exceeds the explicit cap", () => {
    expect(assertGasCostWithinLimit(100n, 3n, 300n)).toBe(300n);
    expect(() => assertGasCostWithinLimit(100n, 3n, 299n)).toThrow(
      /exceeds the explicit limit/,
    );
  });
});
