// Shared by merchant signing and browser verification. No keys or Node runtime.
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
