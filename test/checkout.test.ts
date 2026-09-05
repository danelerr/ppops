import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { CHECKOUT_HTML, CHECKOUT_JS } from "../src/api/checkout.js";

type Element = {
  hidden: boolean;
  disabled: boolean;
  textContent: string;
  className: string;
  href: string;
  onclick?: () => Promise<void>;
  setAttribute: ReturnType<typeof vi.fn>;
};

const request = () => ({
  id: "pi_fixture",
  chainId: 42161,
  tokenSymbol: "USDC",
  decimals: 6,
  tokenAddress: "fixture-token",
  amountAtomic: "1000000",
  receivedAmountAtomic: "0",
  pendingAmountAtomic: "0",
  status: "OPEN",
  expiresAt: Math.floor(Date.now() / 1000) + 3600,
  recipient: "fixture-recipient",
  memo: "fixture-memo",
  expectedMerchantSigner: "fixture-signer",
  descriptor: {},
  reconciliationReady: true,
});

const checkout = async () => {
  const elements: Record<string, Element> = {};
  for (const match of CHECKOUT_HTML.matchAll(/id="([\w-]+)"/g)) {
    elements[match[1]!] = {
      hidden: true,
      disabled: false,
      textContent: "",
      className: "",
      href: "",
      setAttribute: vi.fn(),
    };
  }
  const fetch = vi
    .fn()
    .mockImplementation(async () => Response.json(request()));
  const listener = vi.fn();
  const timer = vi.fn();
  runInNewContext(CHECKOUT_JS, {
    document: {
      hidden: false,
      getElementById: (id: string) => elements[id],
      querySelectorAll: () => [],
      addEventListener: listener,
    },
    location: { pathname: "/pay/pi_fixture" },
    fetch,
    AbortSignal,
    Date,
    setTimeout: timer,
    clearTimeout: vi.fn(),
    navigator: {},
  });
  await vi.waitFor(() => expect(elements.payment!.hidden).toBe(false));
  const update = async (data: Record<string, unknown>) => {
    fetch.mockImplementation(async () =>
      Response.json({ ...request(), ...data }),
    );
    await elements.retry!.onclick!();
  };
  return { elements, fetch, update, listener, timer };
};

describe("checkout guidance", () => {
  it("formats exact amounts and polls the public request without credentials", async () => {
    const page = await checkout();
    expect(page.elements.amount!.textContent).toBe("1.00 USDC");
    expect(page.elements.instructions!.hidden).toBe(false);
    expect(page.fetch).toHaveBeenCalledWith(
      "/pay/pi_fixture/request.json",
      expect.objectContaining({ credentials: "omit", cache: "no-store" }),
    );
    expect(page.timer).toHaveBeenCalledWith(expect.any(Function), 5000);
    await page.update({ amountAtomic: "9007199254740993010000" });
    expect(page.elements.amount!.textContent).toBe("9007199254740993.01 USDC");
  });

  it("explains pending, partial, expired, late and synchronizing states", async () => {
    const { elements, update } = await checkout();
    await update({ pendingAmountAtomic: "1000000" });
    expect(elements.state!.textContent).toContain("Waiting for finality");
    expect(elements.instructions!.hidden).toBe(true);
    expect(elements["step-verifying"]!.className).toBe("active");
    await update({
      status: "PARTIAL",
      receivedAmountAtomic: "500000",
      expiresAt: 1,
    });
    expect(elements.status!.textContent).toBe(
      "Partially paid · request expired",
    );
    expect(elements.instructions!.hidden).toBe(true);
    await update({ expiresAt: 1 });
    expect(elements.status!.textContent).toBe("Request expired");
    await update({
      status: "PAID_LATE",
      receivedAmountAtomic: "1000000",
      expiresAt: 1,
    });
    expect(elements.state!.textContent).toContain("Contact the merchant");
    await update({ reconciliationReady: false });
    expect(elements.connection!.textContent).toContain("synchronizing");
    expect(elements.instructions!.hidden).toBe(true);
    await update({ simulated: true });
    expect(elements["demo-banner"]!.hidden).toBe(false);
    expect(elements.simulate!.hidden).toBe(false);
    expect(elements.instructions!.hidden).toBe(true);
  });

  it("offers recovery and hides stale payment instructions after connection failures", async () => {
    const { elements, fetch, update } = await checkout();
    fetch.mockRejectedValue(new Error("offline"));
    await elements.retry!.onclick!();
    expect(elements.connection!.textContent).toContain("out of date");
    expect(elements.retry!.hidden).toBe(false);
    expect(elements.instructions!.hidden).toBe(true);
    fetch.mockImplementation(async () => Response.json({}, { status: 404 }));
    await elements.retry!.onclick!();
    expect(elements.connection!.textContent).toContain("not found");
    await update({});
    expect(elements.connection!.hidden).toBe(true);
    expect(elements.retry!.hidden).toBe(true);
    expect(elements.instructions!.hidden).toBe(false);
  });
});
