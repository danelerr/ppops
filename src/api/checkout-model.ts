import { getAddress, verifyTypedData } from "ethers";
import { CheckoutHttpSchema } from "./contracts.js";
import {
  DESCRIPTOR_DOMAIN_NAME,
  PAYMENT_DESCRIPTOR_TYPES,
} from "../security/descriptor-format.js";
import type { z } from "zod";

export type CheckoutRequest = z.infer<typeof CheckoutHttpSchema>;

export function verifyCheckoutRequest(
  value: unknown,
  pinnedSigner?: string,
): CheckoutRequest {
  const request = CheckoutHttpSchema.parse(value);
  const { signature, ...descriptor } = request.descriptor;
  const signer = verifyTypedData(
    { name: DESCRIPTOR_DOMAIN_NAME, version: "1", chainId: descriptor.chainId },
    PAYMENT_DESCRIPTOR_TYPES,
    descriptor,
    signature,
  );
  const sameAddress = (a: string, b: string) => getAddress(a) === getAddress(b);
  if (
    !sameAddress(signer, descriptor.merchantSigner) ||
    !sameAddress(signer, request.expectedMerchantSigner) ||
    (pinnedSigner && !sameAddress(signer, pinnedSigner)) ||
    descriptor.version !== 1 ||
    descriptor.chainId !== request.chainId ||
    descriptor.rail !== request.rail ||
    !sameAddress(descriptor.tokenAddress, request.tokenAddress) ||
    descriptor.decimals !== request.decimals ||
    descriptor.amountAtomic !== request.amountAtomic ||
    descriptor.recipient0zk !== request.recipient ||
    descriptor.expiresAt !== request.expiresAt ||
    request.memo.toLowerCase() !==
      "ppops:v1:" + descriptor.reference.toLowerCase()
  ) {
    throw new Error("Payment request signature or signed fields do not match");
  }
  // Simulations are identified by the local demo, never a supported real payment profile.
  if (
    !request.simulated &&
    (request.chainId !== 42161 ||
      request.decimals !== 6 ||
      request.tokenSymbol !== "USDC" ||
      request.tokenAddress.toLowerCase() !==
        "0xaf88d065e77c8cc2239327c5edb3a432268e5831")
  )
    throw new Error("Unsupported payment profile");
  if (
    !/^pi_[0-9a-f]{32}$/.test(request.id) ||
    BigInt(request.amountAtomic) <= 0n
  )
    throw new Error("Invalid payment request");
  const complete = request.status === "PAID" || request.status === "PAID_LATE";
  if (
    complete !== (request.paymentStage === "PAYMENT_COMPLETE") ||
    (complete &&
      BigInt(request.receivedAmountAtomic) < BigInt(request.amountAtomic))
  )
    throw new Error("Inconsistent payment status");
  return request;
}

export function formatAtomic(value: string, decimals = 6): string {
  const text = value.padStart(decimals + 1, "0");
  return decimals
    ? text.slice(0, -decimals) +
        "." +
        text
          .slice(-decimals)
          .replace(/0+$/, "")
          .padEnd(Math.min(decimals, 2), "0")
    : text;
}

export function checkoutPresentation(
  data: CheckoutRequest,
  now = Date.now() / 1000,
) {
  const paid = data.status === "PAID" || data.status === "PAID_LATE";
  const expired = now >= data.expiresAt;
  const pending = BigInt(data.pendingAmountAtomic) > 0n;
  const partial = !paid && BigInt(data.receivedAmountAtomic) > 0n;
  const remaining =
    BigInt(data.amountAtomic) > BigInt(data.receivedAmountAtomic)
      ? BigInt(data.amountAtomic) - BigInt(data.receivedAmountAtomic)
      : 0n;
  let title = "Awaiting payment",
    message =
      "Review the amount, then use a compatible private-payment wallet.";
  if (data.simulated)
    message =
      "Use Simulate payment to try acceptance and merchant fulfillment without a wallet or funds.";
  if (data.status === "PAID") {
    title = "Payment complete";
    message = "Your payment has been accepted. You can close this page.";
  } else if (data.status === "PAID_LATE") {
    title = "Payment received after expiration";
    message =
      "The merchant must review this payment. Contact the merchant before expecting delivery.";
  } else if (data.paymentStage === "PAYMENT_REVERTED") {
    title = "Payment needs review";
    message =
      "A previously detected transfer was reversed. Contact the merchant before paying again.";
  } else if (data.paymentStage === "PRIVACY_CHECKS_PENDING") {
    title = "Payment confirmed onchain";
    message = "It cannot be accepted yet. Privacy validation is still pending.";
  } else if (pending) {
    title = "Payment detected";
    message = "Waiting for confirmation. Do not send another payment.";
  } else if (partial) {
    title = expired
      ? "Partial payment · request expired"
      : "Partial payment received";
    message =
      formatAtomic(remaining.toString(), data.decimals) +
      " " +
      data.tokenSymbol +
      " remaining. Ask the merchant how to complete this order.";
  } else if (expired || data.status === "EXPIRED") {
    title = "Payment request expired";
    message =
      "Contact the merchant to request a new payment link. Do not pay this request.";
  }
  return {
    paid,
    expired,
    pending,
    partial,
    remaining: remaining.toString(),
    title,
    message,
    canPay:
      !paid &&
      !expired &&
      !pending &&
      !partial &&
      data.status === "OPEN" &&
      data.paymentStage === "AWAITING_PAYMENT" &&
      data.reconciliationReady,
  };
}
