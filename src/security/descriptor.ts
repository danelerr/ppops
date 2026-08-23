import { randomBytes } from "node:crypto";

import { MaxUint256, Wallet, getAddress, isAddress, verifyTypedData } from "ethers";
import { z } from "zod";

import {
  RAIL,
  type PaymentDescriptorPayloadV1,
  type SignedPaymentDescriptorV1,
} from "../domain.js";

export const DESCRIPTOR_DOMAIN_NAME = "PPOps Payment Descriptor";

export const PAYMENT_DESCRIPTOR_TYPES = {
  PPOpsPaymentDescriptorV1: [
    { name: "version", type: "uint8" },
    { name: "chainId", type: "uint256" },
    { name: "rail", type: "string" },
    { name: "tokenAddress", type: "address" },
    { name: "decimals", type: "uint8" },
    { name: "amountAtomic", type: "uint256" },
    { name: "recipient0zk", type: "string" },
    { name: "reference", type: "bytes32" },
    { name: "expiresAt", type: "uint64" },
    { name: "nonce", type: "bytes32" },
    { name: "merchantSigner", type: "address" },
  ],
};

export const SignedPaymentDescriptorSchema = z
  .object({
    version: z.literal(1),
    chainId: z.number().int().positive().safe(),
    rail: z.literal(RAIL),
    tokenAddress: z.string().refine(isAddress, "Invalid token address"),
    decimals: z.number().int().min(0).max(255),
    amountAtomic: z
      .string()
      .regex(/^[1-9][0-9]*$/)
      .refine((value) => BigInt(value) <= MaxUint256, "amountAtomic exceeds uint256"),
    recipient0zk: z.string().min(1).max(512),
    reference: z.string().regex(/^0x[0-9a-f]{64}$/i),
    expiresAt: z.number().int().positive().safe(),
    nonce: z.string().regex(/^0x[0-9a-f]{64}$/i),
    merchantSigner: z.string().refine(isAddress, "Invalid merchant signer"),
    signature: z.string().regex(/^0x[0-9a-f]{130}$/i),
  })
  .strict();

export const parseSignedDescriptor = (value: unknown): SignedPaymentDescriptorV1 =>
  SignedPaymentDescriptorSchema.parse(value) as SignedPaymentDescriptorV1;

const domainFor = (chainId: number) => ({
  name: DESCRIPTOR_DOMAIN_NAME,
  version: "1",
  chainId,
});

export type CreateDescriptorInput = {
  chainId: number;
  tokenAddress: string;
  decimals: number;
  amountAtomic: string;
  recipient0zk: string;
  reference: string;
  expiresAt: number;
};

export const createSignedDescriptor = async (
  input: CreateDescriptorInput,
  merchantPrivateKey: string,
): Promise<SignedPaymentDescriptorV1> => {
  const wallet = new Wallet(merchantPrivateKey);
  const payload: PaymentDescriptorPayloadV1 = {
    version: 1,
    chainId: input.chainId,
    rail: RAIL,
    tokenAddress: getAddress(input.tokenAddress),
    decimals: input.decimals,
    amountAtomic: input.amountAtomic,
    recipient0zk: input.recipient0zk,
    reference: input.reference.toLowerCase(),
    expiresAt: input.expiresAt,
    nonce: `0x${randomBytes(32).toString("hex")}`,
    merchantSigner: wallet.address,
  };
  const signature = await wallet.signTypedData(
    domainFor(payload.chainId),
    PAYMENT_DESCRIPTOR_TYPES,
    payload,
  );
  return { ...payload, signature };
};

export const verifySignedDescriptor = (
  descriptor: SignedPaymentDescriptorV1,
  expectedSigner: string,
): string => {
  const parsed = parseSignedDescriptor(descriptor);
  const { signature, ...payload } = parsed;
  const recovered = verifyTypedData(
    domainFor(payload.chainId),
    PAYMENT_DESCRIPTOR_TYPES,
    payload,
    signature,
  );
  const trustedSigner = getAddress(expectedSigner);
  if (getAddress(payload.merchantSigner) !== trustedSigner || getAddress(recovered) !== trustedSigner) {
    throw new Error("Descriptor signer does not match the independently trusted merchant signer");
  }
  return recovered;
};
