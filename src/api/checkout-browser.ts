/// <reference lib="dom" />
import QRCode from "qrcode";
import {
  checkoutPresentation,
  formatAtomic,
  verifyCheckoutRequest,
  type CheckoutRequest,
} from "./checkout-model.js";

const byId = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const intentId = location.pathname.split("/").filter(Boolean).at(-1)!;
const requestPath = "/pay/" + encodeURIComponent(intentId) + "/request.json";
// Deliberately discard query and fragment: no order metadata or trust pins in links.
const requestUrl = new URL(requestPath, location.origin).href;
let timer: ReturnType<typeof setTimeout> | undefined,
  lastData: CheckoutRequest | undefined;
let loading = false,
  stale = false,
  identity: string | undefined,
  pinnedSigner: string | undefined,
  qrReady = false;

function render(data: CheckoutRequest) {
  const view = checkoutPresentation(data);
  byId("amount").textContent =
    formatAtomic(data.amountAtomic, data.decimals) + " " + data.tokenSymbol;
  byId("network").textContent = data.simulated
    ? "Local simulation · no funds move"
    : "Arbitrum One · private USDC";
  byId("status").textContent = view.title;
  byId("state").textContent = view.message;
  byId("state").className = data.status === "PAID" ? "success" : "";
  byId("verification").textContent = pinnedSigner
    ? "Matches your trusted signer"
    : "Signature valid · identity not verified";
  byId("received").textContent =
    formatAtomic(data.receivedAmountAtomic, data.decimals) +
    " " +
    data.tokenSymbol;
  byId("pending").textContent =
    formatAtomic(data.pendingAmountAtomic, data.decimals) +
    " " +
    data.tokenSymbol;
  byId("remaining").textContent =
    formatAtomic(view.remaining, data.decimals) + " " + data.tokenSymbol;
  byId("received").hidden = byId("received-label").hidden =
    !view.paid && !view.partial;
  byId("pending").hidden = byId("pending-label").hidden = !view.pending;
  byId("remaining").hidden = byId("remaining-label").hidden = !view.partial;
  byId("overpayment").textContent =
    formatAtomic(data.overpaymentAmountAtomic, data.decimals) +
    " " +
    data.tokenSymbol +
    " · merchant review";
  byId("overpayment").hidden = byId("overpayment-label").hidden =
    BigInt(data.overpaymentAmountAtomic) === 0n;
  const seconds = Math.max(0, data.expiresAt - Math.floor(Date.now() / 1000));
  byId("expiry").textContent = seconds
    ? Math.floor(seconds / 60) +
      ":" +
      String(seconds % 60).padStart(2, "0") +
      " remaining"
    : "Expired";
  byId("chain").textContent = String(data.chainId);
  byId("token").textContent = data.tokenAddress;
  byId("recipient").textContent = data.recipient;
  byId("memo").textContent = data.memo;
  byId("signer").textContent = data.expectedMerchantSigner;
  byId("descriptor").textContent = JSON.stringify(data.descriptor, null, 2);
  byId<HTMLAnchorElement>("request-download").href = requestPath;
  byId("request-download").setAttribute("download", "ppops-request.json");
  byId("request-url").textContent = requestUrl;
  byId("demo-banner").hidden = !data.simulated;
  byId("demo-next").hidden = !data.simulated;
  byId("simulate").hidden = !data.simulated || !view.canPay || stale;
  byId("instructions").hidden =
    !view.canPay || data.simulated === true || stale;
  byId("step-waiting").className =
    view.paid || view.pending || view.partial ? "done" : "active";
  byId("step-verifying").className = view.paid
    ? "done"
    : view.pending || view.partial
      ? "active"
      : "";
  byId("step-paid").className = data.status === "PAID" ? "done" : "";
  byId("payment").hidden = false;
  byId("connection").hidden = data.reconciliationReady && !stale;
  if (!data.reconciliationReady && !stale)
    byId("connection").textContent =
      "The merchant is synchronizing payment history. Wait before sending; updates may be delayed.";
}

function unavailable(message: string) {
  stale = true;
  if (lastData) render(lastData);
  byId("instructions").hidden = true;
  byId("simulate").hidden = true;
  byId("connection").hidden = false;
  byId("connection").textContent = message;
  byId("retry").hidden = false;
  byId("verification").textContent = "Current request not verified";
}

async function load() {
  if (loading) return;
  loading = true;
  clearTimeout(timer);
  byId("retry").hidden = true;
  try {
    const response = await fetch(requestPath, {
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      unavailable(
        response.status === 404
          ? "Payment request not found. Check the link with the merchant."
          : "Payment details are unavailable. Check again before sending.",
      );
      return;
    }
    const data = verifyCheckoutRequest(await response.json(), pinnedSigner);
    const fingerprint = JSON.stringify({
      id: data.id,
      descriptor: data.descriptor,
    });
    if (data.id !== intentId || (identity && identity !== fingerprint))
      throw new Error("Request changed");
    identity = fingerprint;
    lastData = data;
    stale = false;
    render(data);
  } catch {
    unavailable(
      "Unable to verify current payment details. The connection may be interrupted or the request may have changed. Do not send funds; check again or contact the merchant. Any displayed status may be out of date.",
    );
  } finally {
    loading = false;
    if (!document.hidden) timer = setTimeout(load, 5000);
  }
}

byId("retry").onclick = load;
document.addEventListener("visibilitychange", () => {
  clearTimeout(timer);
  if (!document.hidden) void load();
});
byId("pay").onclick = async () => {
  if (!lastData || stale || !checkoutPresentation(lastData).canPay) return;
  byId("handoff").hidden = false;
  byId("pay").setAttribute("aria-expanded", "true");
  if (!qrReady) {
    try {
      await QRCode.toCanvas(byId<HTMLCanvasElement>("request-qr"), requestUrl, {
        width: 264,
        margin: 4,
        errorCorrectionLevel: "M",
      });
      qrReady = true;
      if (
        location.hostname === "localhost" ||
        location.hostname === "127.0.0.1" ||
        location.hostname === "[::1]"
      )
        byId("qr-message").textContent =
          "Local-only link: another device cannot reach this loopback address. Use the file or a payer on this machine.";
    } catch {
      byId("qr-message").textContent =
        "QR unavailable. Copy the request link or download the file instead.";
    }
  }
};
byId("copy-request").onclick = async () => {
  if (!lastData || stale || !checkoutPresentation(lastData).canPay) return;
  try {
    await navigator.clipboard.writeText(requestUrl);
    byId("copy-request").textContent = "Copied";
  } catch {
    byId("qr-message").textContent =
      "Copy unavailable. Select the request link above and copy it manually.";
  }
};
byId("verify-signer").onclick = async () => {
  if (!lastData) return;
  const expected = byId<HTMLInputElement>("trusted-signer").value.trim();
  try {
    if (!expected) throw new Error("Missing signer");
    verifyCheckoutRequest(lastData, expected);
    pinnedSigner = expected;
    byId("signer-result").textContent =
      "Signature matches the public signer you supplied. Trust depends on how you obtained it.";
    // A corrected pin must pass a fresh fetch before payment controls reopen.
    await load();
  } catch {
    byId("signer-result").textContent =
      "Signer does not match or is invalid. Do not pay; confirm the public signer with the merchant.";
    unavailable(
      "Merchant signer comparison failed. Payment instructions are disabled until a matching independently obtained signer is supplied.",
    );
    // Pin the attempted value as well: polling must not silently unlock a mismatch.
    pinnedSigner = expected || "invalid";
  }
};
byId("simulate").onclick = async () => {
  if (!lastData?.simulated || stale || !checkoutPresentation(lastData).canPay)
    return;
  byId<HTMLButtonElement>("simulate").disabled = true;
  try {
    const response = await fetch(
      "/demo/" + encodeURIComponent(intentId) + "/confirm",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
        credentials: "omit",
        redirect: "error",
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!response.ok) throw new Error("Simulation failed");
    await load();
  } catch {
    unavailable("Simulation could not complete. Check again before retrying.");
  } finally {
    byId<HTMLButtonElement>("simulate").disabled = false;
  }
};
void load();
