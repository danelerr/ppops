import { MaxUint256, getAddress, isAddress, verifyTypedData } from "ethers";
import { validateRailgunAddress } from "@railgun-community/wallet";
import { z } from "zod";

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
    rail: z.literal("railgun"),
    tokenAddress: z.string().refine(isAddress, "Invalid token address"),
    decimals: z.number().int().min(0).max(255),
    amountAtomic: z
      .string()
      .regex(/^[1-9][0-9]*$/)
      .refine((value) => BigInt(value) <= MaxUint256, "amountAtomic exceeds uint256"),
    recipient0zk: z
      .string()
      .regex(/^0zk\S{32,256}$/)
      .refine(validateRailgunAddress, "Invalid RAILGUN recipient"),
    reference: z.string().regex(/^0x[0-9a-f]{64}$/i),
    expiresAt: z.number().int().positive().safe(),
    nonce: z.string().regex(/^0x[0-9a-f]{64}$/i),
    merchantSigner: z.string().refine(isAddress, "Invalid merchant signer"),
    signature: z.string().regex(/^0x[0-9a-f]{130}$/i),
  })
  .strict();

export type SignedPaymentDescriptor = z.infer<typeof SignedPaymentDescriptorSchema>;

const domainFor = (chainId: number) => ({
  name: DESCRIPTOR_DOMAIN_NAME,
  version: "1",
  chainId,
});

export const verifySignedDescriptor = (
  descriptor: SignedPaymentDescriptor,
  expectedSigner: string,
): string => {
  const parsed = SignedPaymentDescriptorSchema.parse(descriptor);
  const { signature, ...payload } = parsed;
  const recovered = verifyTypedData(
    domainFor(payload.chainId),
    PAYMENT_DESCRIPTOR_TYPES,
    payload,
    signature,
  );
  const trustedSigner = getAddress(expectedSigner);
  if (
    getAddress(payload.merchantSigner) !== trustedSigner ||
    getAddress(recovered) !== trustedSigner
  ) {
    throw new Error("Descriptor signer does not match the independently trusted signer");
  }
  return recovered;
};
