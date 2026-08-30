import { Transaction, Wallet } from "ethers";
import { describe, expect, it } from "vitest";

import {
  buildBoundedSelfSignedTransaction,
  signBoundedSelfSignedTransaction,
} from "../src/railgun/self-signed-transfer.js";
import { assertPopulatedNullifiers } from "../src/railgun/populated-transfer.js";

const PROXY = "0x0000000000000000000000000000000000001234";

describe("bounded self-signed transaction", () => {
  it("pins destination, zero value, chain, fees and precomputable hash", async () => {
    const wallet = Wallet.createRandom();
    const request = buildBoundedSelfSignedTransaction({
      populatedTransaction: {
        to: PROXY,
        data: "0x1234",
        value: 0n,
        gasPrice: 99n,
      },
      proxyContract: PROXY,
      gasLimit: 500_000n,
      maxFeePerGas: 3n,
      maxPriorityFeePerGas: 1n,
      nonce: 7,
    });
    expect(request).toMatchObject({
      to: PROXY,
      value: 0n,
      gasPrice: undefined,
      chainId: 42_161,
      type: 2,
      nonce: 7,
      gasLimit: 500_000n,
      maxFeePerGas: 3n,
      maxPriorityFeePerGas: 1n,
    });

    const signed = await signBoundedSelfSignedTransaction(
      wallet,
      request,
      wallet.address,
      7,
    );
    const parsed = Transaction.from(signed.signedTransaction);
    expect(parsed.hash).toBe(signed.transactionHash);
    expect(parsed.from).toBe(wallet.address);
    expect(parsed.to).toBe(PROXY);
    expect(parsed.value).toBe(0n);
    expect(parsed.chainId).toBe(42_161n);
  });

  it("rejects an incomplete, redirected or value-bearing populated transfer", () => {
    const base = {
      proxyContract: PROXY,
      gasLimit: 500_000n,
      maxFeePerGas: 3n,
      maxPriorityFeePerGas: 1n,
      nonce: 7,
    };
    expect(() =>
      buildBoundedSelfSignedTransaction({
        ...base,
        populatedTransaction: { to: PROXY },
      }),
    ).toThrow(/incomplete/);
    expect(() =>
      buildBoundedSelfSignedTransaction({
        ...base,
        populatedTransaction: {
          to: "0x0000000000000000000000000000000000005678",
          data: "0x1234",
        },
      }),
    ).toThrow(/target/);
    expect(() =>
      buildBoundedSelfSignedTransaction({
        ...base,
        populatedTransaction: { to: PROXY, data: "0x1234", value: 1n },
      }),
    ).toThrow(/sends ETH/);
  });

  it("normalizes a bounded, unique nullifier set", () => {
    expect(assertPopulatedNullifiers([`0x${"AB".repeat(32)}`])).toEqual([
      `0x${"ab".repeat(32)}`,
    ]);
    expect(() => assertPopulatedNullifiers(undefined)).toThrow(/nullifier/);
    expect(() =>
      assertPopulatedNullifiers([`0x${"11".repeat(32)}`, `0x${"11".repeat(32)}`]),
    ).toThrow(/invalid/);
    expect(() => assertPopulatedNullifiers([`0x${"00".repeat(32)}`])).toThrow(
      /invalid/,
    );
  });
});
