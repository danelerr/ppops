import { runInNewContext } from "node:vm";
import { Wallet, formatUnits } from "ethers";
import QRCode from "qrcode";
import { describe, expect, it, vi } from "vitest";
import { CHECKOUT_HTML, CHECKOUT_JS } from "../src/api/checkout.js";
import { createSignedDescriptor } from "../src/security/descriptor.js";
import {
  checkoutPresentation,
  formatAtomic,
  verifyCheckoutRequest,
} from "../src/api/checkout-model.js";

async function signedRequest() {
  const signer = Wallet.createRandom();
  const descriptor = await createSignedDescriptor(
    {
      chainId: 42161,
      tokenAddress: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
      decimals: 6,
      amountAtomic: "1000000",
      expiresAt: 2_000_000_000,
      recipient0zk: "0zk-test-receiver",
      reference: "0x" + "ab".repeat(32),
    },
    signer.privateKey,
  );
  return {
    id: "pi_" + "12".repeat(16),
    chainId: descriptor.chainId,
    rail: "railgun" as const,
    tokenSymbol: "USDC",
    tokenAddress: descriptor.tokenAddress,
    decimals: 6,
    amountAtomic: descriptor.amountAtomic,
    amountFormatted: formatUnits(descriptor.amountAtomic, 6),
    receivedAmountAtomic: "0",
    pendingAmountAtomic: "0",
    overpaymentAmountAtomic: "0",
    status: "OPEN" as const,
    expiresAt: descriptor.expiresAt,
    recipient: descriptor.recipient0zk,
    memo: "ppops:v1:" + descriptor.reference,
    expectedMerchantSigner: descriptor.merchantSigner,
    descriptor,
    reconciliationReady: true,
    paymentStage: "AWAITING_PAYMENT" as const,
  };
}

type Element = {
  hidden: boolean;
  disabled: boolean;
  textContent: string;
  className: string;
  href: string;
  value: string;
  onclick?: () => Promise<void>;
  setAttribute: ReturnType<typeof vi.fn>;
};

async function checkout() {
  const request = await signedRequest();
  const elements: Record<string, Element> = {};
  for (const match of CHECKOUT_HTML.matchAll(/id="([\w-]+)"/g))
    elements[match[1]!] = {
      hidden: true,
      disabled: false,
      textContent: "",
      className: "",
      href: "",
      value: "",
      setAttribute: vi.fn(),
    };
  const fetch = vi.fn().mockImplementation(async () => Response.json(request));
  const pixels = vi.fn();
  const canvas = Object.assign(elements["request-qr"]!, {
    width: 0,
    height: 0,
    style: {},
    getContext: () => ({
      createImageData: (width: number, height: number) => ({
        data: new Uint8ClampedArray(width * height * 4),
      }),
      clearRect: vi.fn(),
      putImageData: pixels,
    }),
  });
  const clipboard = vi.fn();
  const listener = vi.fn(),
    timer = vi.fn(),
    clock = { now: 1_999_999_000_000 };
  class PageDate extends Date {
    static override now() {
      return clock.now;
    }
  }
  runInNewContext(CHECKOUT_JS, {
    document: {
      hidden: false,
      getElementById: (id: string) => elements[id],
      querySelectorAll: () => [],
      addEventListener: listener,
    },
    location: {
      pathname: "/pay/" + request.id,
      origin: "http://localhost:8787",
      hostname: "localhost",
      search: "?order=PRIVATE",
      hash: "#PRIVATE",
    },
    fetch,
    AbortSignal,
    URL,
    TextEncoder,
    TextDecoder,
    Date: PageDate,
    setTimeout: timer,
    clearTimeout: vi.fn(),
    navigator: { clipboard: { writeText: clipboard } },
  });
  await vi.waitFor(() => expect(elements.payment!.hidden).toBe(false));
  const update = async (data: Record<string, unknown>) => {
    fetch.mockImplementation(async () =>
      Response.json({ ...request, ...data }),
    );
    await elements.retry!.onclick!();
  };
  return {
    request,
    elements,
    fetch,
    update,
    listener,
    timer,
    clock,
    canvas,
    pixels,
    clipboard,
  };
}

describe("PayIn checkout", () => {
  it("renders the request QR locally and copies only the opaque request URL", async () => {
    const { elements, request, pixels, canvas, clipboard, fetch } =
      await checkout();
    await elements.pay!.onclick!();
    const url = "http://localhost:8787/pay/" + request.id + "/request.json";
    expect(elements.handoff!.hidden).toBe(false);
    expect(elements["qr-message"]!.textContent).toContain("Local-only link");
    expect(canvas.width).toBe(264);
    const rendered = pixels.mock.calls[0]![0].data;
    expect(new Set(rendered)).toEqual(new Set([0, 255]));
    await QRCode.toCanvas(canvas, url, {
      width: 264,
      margin: 4,
      errorCorrectionLevel: "M",
    });
    expect(rendered).toEqual(pixels.mock.calls[1]![0].data);
    await elements["copy-request"]!.onclick!();
    expect(clipboard).toHaveBeenCalledWith(url);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("verifies signatures locally without claiming independent merchant identity", async () => {
    const page = await checkout();
    expect(page.elements.verification!.textContent).toContain(
      "identity not verified",
    );
    expect(page.elements.amount!.textContent).toBe("1.00 USDC");
    expect(page.elements.instructions!.hidden).toBe(false);
    expect(page.fetch).toHaveBeenCalledWith(
      "/pay/" + page.request.id + "/request.json",
      expect.objectContaining({
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
      }),
    );
    expect(page.timer).toHaveBeenCalledWith(expect.any(Function), 5000);
    expect(formatAtomic("9007199254740993010000")).toBe("9007199254740993.01");
  });

  it("does not accept pending or finalized-only value as complete", async () => {
    const { elements, update } = await checkout();
    await update({
      pendingAmountAtomic: "1000000",
      paymentStage: "PAYMENT_DETECTED",
    });
    expect(elements.status!.textContent).toBe("Payment detected");
    expect(elements.instructions!.hidden).toBe(true);
    expect(elements["step-paid"]!.className).not.toBe("done");
    await update({
      pendingAmountAtomic: "1000000",
      paymentStage: "PRIVACY_CHECKS_PENDING",
    });
    expect(elements.status!.textContent).toBe("Payment confirmed onchain");
    expect(elements.state!.textContent).toContain("cannot be accepted yet");
    expect(elements["step-paid"]!.className).not.toBe("done");
  });

  it("explains partial, overpaid, late, expired and reverted payments", async () => {
    const { elements, update, clock } = await checkout();
    await update({ status: "PARTIAL", receivedAmountAtomic: "500000" });
    expect(elements.state!.textContent).toContain("0.50 USDC remaining");
    expect(elements.instructions!.hidden).toBe(true);
    clock.now = 2_000_000_000_000;
    await update({ status: "PARTIAL", receivedAmountAtomic: "500000" });
    expect(elements.status!.textContent).toBe(
      "Partial payment · request expired",
    );
    await update({});
    expect(elements.status!.textContent).toBe("Payment request expired");
    await update({
      status: "PAID_LATE",
      receivedAmountAtomic: "1000000",
      paymentStage: "PAYMENT_COMPLETE",
    });
    expect(elements.state!.textContent).toContain("merchant must review");
    expect(elements["step-paid"]!.className).not.toBe("done");
    await update({
      status: "PAID",
      receivedAmountAtomic: "1100000",
      overpaymentAmountAtomic: "100000",
      paymentStage: "PAYMENT_COMPLETE",
    });
    expect(elements.status!.textContent).toBe("Payment complete");
    expect(elements.overpayment!.textContent).toContain("0.10 USDC");
    await update({ paymentStage: "PAYMENT_REVERTED" });
    expect(elements.state!.textContent).toContain("reversed");
    expect(elements.instructions!.hidden).toBe(true);
  });

  it("recovers safely from offline, unknown request and synchronizing states", async () => {
    const { elements, fetch, update } = await checkout();
    fetch.mockRejectedValue(new Error("offline"));
    await elements.retry!.onclick!();
    expect(elements.connection!.textContent).toContain("out of date");
    expect(elements.instructions!.hidden).toBe(true);
    fetch.mockImplementation(async () => Response.json({}, { status: 404 }));
    await elements.retry!.onclick!();
    expect(elements.connection!.textContent).toContain("not found");
    await update({ reconciliationReady: false });
    expect(elements.connection!.textContent).toContain("synchronizing");
    expect(elements.instructions!.hidden).toBe(true);
    await update({});
    expect(elements.connection!.hidden).toBe(true);
    expect(elements.instructions!.hidden).toBe(false);
  });

  it("keeps a failed independent signer comparison locked across polls, then allows correction", async () => {
    const { elements, request, update } = await checkout();
    elements["trusted-signer"]!.value = Wallet.createRandom().address;
    await elements["verify-signer"]!.onclick!();
    await update({});
    expect(elements.instructions!.hidden).toBe(true);
    elements["trusted-signer"]!.value = request.expectedMerchantSigner;
    await elements["verify-signer"]!.onclick!();
    expect(elements.verification!.textContent).toBe(
      "Matches your trusted signer",
    );
    expect(elements.instructions!.hidden).toBe(false);
  });

  it("rejects a changed signed request and inconsistent paid projections", async () => {
    const { elements, update } = await checkout();
    await update({ amountAtomic: "2000000" });
    expect(elements.instructions!.hidden).toBe(true);
    expect(elements.connection!.textContent).toContain("Unable to verify");
    await update({ status: "PAID", paymentStage: "PAYMENT_COMPLETE" });
    expect(elements.status!.textContent).not.toBe("Payment complete");
  });

  it("distinguishes a simulation from a real payment", async () => {
    const { elements, update } = await checkout();
    await update({ simulated: true });
    expect(elements["demo-banner"]!.hidden).toBe(false);
    expect(elements.simulate!.hidden).toBe(false);
    expect(elements.instructions!.hidden).toBe(true);
  });
});

describe("request contract and payment presentation", () => {
  it("binds every displayed payment field to the EIP-712 descriptor", async () => {
    const request = await signedRequest();
    expect(verifyCheckoutRequest(request).amountAtomic).toBe("1000000");
    for (const change of [
      { amountAtomic: "2" },
      { recipient: "other" },
      { memo: "other" },
      { decimals: 18 },
      { expiresAt: 1 },
      { chainId: 1 },
      { tokenAddress: "0x" + "11".repeat(20) },
      { expectedMerchantSigner: Wallet.createRandom().address },
    ])
      expect(() => verifyCheckoutRequest({ ...request, ...change })).toThrow();
    expect(() =>
      verifyCheckoutRequest({
        ...request,
        descriptor: { ...request.descriptor, amountAtomic: "2" },
      }),
    ).toThrow();
  });

  it("disables payment on expiry even before the next network poll", async () => {
    const request = verifyCheckoutRequest(await signedRequest());
    expect(checkoutPresentation(request, request.expiresAt - 1).canPay).toBe(
      true,
    );
    expect(checkoutPresentation(request, request.expiresAt).canPay).toBe(false);
  });

  it("keeps protocol internals behind advanced details and loads only same-origin assets", () => {
    const primary = CHECKOUT_HTML.split("<details>")[0]!;
    expect(primary).not.toMatch(/PPOI|Broadcaster|nullifier|0zk|memo/);
    expect(CHECKOUT_HTML).not.toMatch(
      /<script[^>]+https?:|<link[^>]+https?:|\son[a-z]+="/,
    );
    expect(primary).toContain("request-qr");
    expect(CHECKOUT_HTML).toMatch(/\/assets\/pay\.js\?v=[0-9a-f]{16}/);
    expect(CHECKOUT_HTML).toMatch(/\/assets\/pay\.css\?v=[0-9a-f]{16}/);
  });
});
