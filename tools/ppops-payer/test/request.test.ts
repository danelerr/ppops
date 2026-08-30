import { Wallet, formatUnits } from "ethers";
import { describe, expect, it } from "vitest";

import {
  DESCRIPTOR_DOMAIN_NAME,
  PAYMENT_DESCRIPTOR_TYPES,
  type SignedPaymentDescriptor,
} from "../src/descriptor.js";
import {
  assertLivePaymentRequestSource,
  assertSamePaymentRequest,
  verifyPaymentRequest,
  type PaymentRequest,
} from "../src/request.js";

const RECIPIENT =
  "0zk1qykzjxctynyz4z43pukckpv43jyzhyvy0ehrd5wuc54l5enqf9qfrrv7j6fe3z53la7enqphqvxys9aqyp9xx0km95ehqslx8apmu8l7anc7emau4tvsultrkvd";

const signedRequest = async () => {
  const signer = Wallet.createRandom();
  const descriptorPayload = {
    version: 1 as const,
    chainId: 42_161,
    rail: "railgun" as const,
    tokenAddress: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    decimals: 6,
    amountAtomic: "100000",
    recipient0zk: RECIPIENT,
    reference: `0x${"ab".repeat(32)}`,
    expiresAt: 2_000_000_000,
    nonce: `0x${"cd".repeat(32)}`,
    merchantSigner: signer.address,
  };
  const signature = await signer.signTypedData(
    { name: DESCRIPTOR_DOMAIN_NAME, version: "1", chainId: 42_161 },
    PAYMENT_DESCRIPTOR_TYPES,
    descriptorPayload,
  );
  const descriptor: SignedPaymentDescriptor = { ...descriptorPayload, signature };
  return {
    signer,
    request: {
      id: `pi_${"12".repeat(16)}`,
      chainId: 42_161,
      tokenAddress: descriptor.tokenAddress,
      tokenSymbol: "USDC",
      decimals: 6,
      amountAtomic: descriptor.amountAtomic,
      amountFormatted: formatUnits(descriptor.amountAtomic, 6),
      receivedAmountAtomic: "0",
      pendingAmountAtomic: "0",
      status: "OPEN",
      expiresAt: descriptor.expiresAt,
      rail: "railgun",
      recipient: RECIPIENT,
      memo: `ppops:v1:${descriptor.reference}`,
      descriptor,
      expectedMerchantSigner: signer.address,
    },
  };
};

describe("PPOps payment request verification", () => {
  it("accepts an exact, unspent request signed by the independently pinned signer", async () => {
    const { request, signer } = await signedRequest();
    expect(verifyPaymentRequest(request, signer.address, 1_900_000_000)).toEqual(request);
  });

  it("rejects a substituted signer", async () => {
    const { request } = await signedRequest();
    expect(() =>
      verifyPaymentRequest(request, Wallet.createRandom().address, 1_900_000_000),
    ).toThrow(/trusted signer/);
  });

  it("rejects unsigned request-field tampering even when the descriptor is intact", async () => {
    const { request, signer } = await signedRequest();
    expect(() =>
      verifyPaymentRequest({ ...request, amountAtomic: "100001" }, signer.address, 1_900_000_000),
    ).toThrow(/amount mismatch/);
    expect(() =>
      verifyPaymentRequest({ ...request, memo: `ppops:v1:0x${"ef".repeat(32)}` }, signer.address, 1_900_000_000),
    ).toThrow(/Memo\/reference mismatch/);
  });

  it("refuses paid, pending and expired requests", async () => {
    const { request, signer } = await signedRequest();
    expect(() =>
      verifyPaymentRequest({ ...request, status: "PAID" }, signer.address, 1_900_000_000),
    ).toThrow(/not OPEN/);
    expect(() =>
      verifyPaymentRequest({ ...request, pendingAmountAtomic: "1" }, signer.address, 1_900_000_000),
    ).toThrow(/pending settlement/);
    expect(() => verifyPaymentRequest(request, signer.address, 2_000_000_001)).toThrow(
      /expired/,
    );
  });

  it("requires a live request source for value-bearing submission", () => {
    expect(() =>
      assertLivePaymentRequestSource(
        "http://127.0.0.1:8787/pay/pi_example/request.json",
      ),
    ).not.toThrow();
    expect(() => assertLivePaymentRequestSource("./request.json")).toThrow(/live HTTP/);
  });

  it("detects request replacement during proof generation", async () => {
    const { request, signer } = await signedRequest();
    const original = verifyPaymentRequest(request, signer.address, 1_900_000_000);
    const same = verifyPaymentRequest(
      structuredClone(request),
      signer.address,
      1_900_000_000,
    );
    expect(() => assertSamePaymentRequest(original, same)).not.toThrow();

    const replaced = verifyPaymentRequest(
      { ...request, id: `pi_${"34".repeat(16)}` },
      signer.address,
      1_900_000_000,
    );
    expect(() => assertSamePaymentRequest(original, replaced)).toThrow(/changed/);
  });
});
