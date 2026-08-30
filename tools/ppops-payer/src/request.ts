import { lstat, readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { resolve } from "node:path";

import { formatUnits, getAddress } from "ethers";
import { validateRailgunAddress } from "@railgun-community/wallet";
import { z } from "zod";

import {
  PAYER_CHAIN_ID,
  PAYER_TOKEN_ADDRESS,
  PAYER_TOKEN_DECIMALS,
  PAYER_TOKEN_SYMBOL,
} from "./constants.js";
import {
  SignedPaymentDescriptorSchema,
  verifySignedDescriptor,
} from "./descriptor.js";

const MAX_REQUEST_BYTES = 64 * 1024;

const PaymentRequestSchema = z
  .object({
    id: z.string().regex(/^pi_[0-9a-f]{32}$/),
    chainId: z.number().int().positive().safe(),
    tokenAddress: z.string(),
    tokenSymbol: z.string(),
    decimals: z.number().int().min(0).max(255),
    amountAtomic: z.string().regex(/^[1-9][0-9]*$/),
    amountFormatted: z.string().min(1).max(128),
    receivedAmountAtomic: z.string().regex(/^(?:0|[1-9][0-9]*)$/),
    pendingAmountAtomic: z.string().regex(/^(?:0|[1-9][0-9]*)$/),
    status: z.enum(["OPEN", "PARTIAL", "PAID", "EXPIRED", "PAID_LATE"]),
    expiresAt: z.number().int().positive().safe(),
    rail: z.literal("railgun"),
    recipient: z
      .string()
      .regex(/^0zk\S{32,256}$/)
      .refine(validateRailgunAddress, "Invalid RAILGUN recipient"),
    memo: z.string().regex(/^ppops:v1:0x[0-9a-f]{64}$/i),
    descriptor: SignedPaymentDescriptorSchema,
    expectedMerchantSigner: z.string(),
  })
  .strict();

export type PaymentRequest = z.infer<typeof PaymentRequestSchema>;

const assertSame = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message);
};

export const verifyPaymentRequest = (
  value: unknown,
  expectedSigner: string,
  nowSeconds = Math.floor(Date.now() / 1_000),
): PaymentRequest => {
  const request = PaymentRequestSchema.parse(value);
  verifySignedDescriptor(request.descriptor, expectedSigner);
  const descriptor = request.descriptor;
  assertSame(request.status === "OPEN", "Payment request is not OPEN");
  assertSame(request.receivedAmountAtomic === "0", "Payment request already received funds");
  assertSame(request.pendingAmountAtomic === "0", "Payment request has a pending settlement");
  assertSame(request.expiresAt > nowSeconds, "Payment request is expired");
  assertSame(descriptor.expiresAt === request.expiresAt, "Expiry mismatch");
  assertSame(request.chainId === PAYER_CHAIN_ID, "Unsupported chain ID");
  assertSame(descriptor.chainId === request.chainId, "Descriptor chain mismatch");
  assertSame(
    request.tokenAddress.toLowerCase() === PAYER_TOKEN_ADDRESS,
    "Unsupported payment token",
  );
  assertSame(
    descriptor.tokenAddress.toLowerCase() === request.tokenAddress.toLowerCase(),
    "Descriptor token mismatch",
  );
  assertSame(
    request.tokenSymbol === PAYER_TOKEN_SYMBOL && request.decimals === PAYER_TOKEN_DECIMALS,
    "Unsupported token metadata",
  );
  assertSame(descriptor.decimals === request.decimals, "Descriptor decimals mismatch");
  assertSame(descriptor.amountAtomic === request.amountAtomic, "Descriptor amount mismatch");
  assertSame(
    request.amountFormatted === formatUnits(request.amountAtomic, request.decimals),
    "Formatted amount mismatch",
  );
  assertSame(descriptor.recipient0zk === request.recipient, "Recipient mismatch");
  assertSame(
    request.memo.toLowerCase() === `ppops:v1:${descriptor.reference.toLowerCase()}`,
    "Memo/reference mismatch",
  );
  assertSame(
    getAddress(request.expectedMerchantSigner) === getAddress(expectedSigner),
    "Checkout signer field does not match the trusted signer",
  );
  return request;
};

export const assertSamePaymentRequest = (
  original: PaymentRequest,
  refreshed: PaymentRequest,
): void => {
  if (!isDeepStrictEqual(original, refreshed)) {
    throw new Error("Payment request changed while preparing the transfer");
  }
};

export const assertLivePaymentRequestSource = (source: string): void => {
  if (!/^https?:\/\//i.test(source)) {
    throw new Error("Payment submission requires a live HTTP(S) payment request");
  }
};

const readResponseBody = async (response: Response): Promise<string> => {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) {
    throw new Error("Payment request exceeds the size limit");
  }
  if (!response.body) throw new Error("Payment request response has no body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_REQUEST_BYTES) {
      await reader.cancel();
      throw new Error("Payment request exceeds the size limit");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
};

const loadFromUrl = async (source: string): Promise<unknown> => {
  const url = new URL(source);
  if (url.username || url.password) throw new Error("Request URL credentials are forbidden");
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error("Remote payment requests require HTTPS");
  }
  const response = await fetch(url, {
    cache: "no-store",
    credentials: "omit",
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Payment request returned HTTP ${response.status}`);
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim();
  if (contentType !== "application/json") throw new Error("Payment request is not JSON");
  return JSON.parse(await readResponseBody(response)) as unknown;
};

const loadFromFile = async (source: string): Promise<unknown> => {
  const path = resolve(source);
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.size > MAX_REQUEST_BYTES) {
    throw new Error("Payment request file is invalid or too large");
  }
  return JSON.parse(await readFile(path, "utf8")) as unknown;
};

export const loadPaymentRequest = async (source: string): Promise<unknown> =>
  /^https?:\/\//i.test(source) ? loadFromUrl(source) : loadFromFile(source);
