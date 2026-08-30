import { JsonRpcProvider, type TransactionReceipt } from "ethers";

import type { PayerConfig } from "../config.js";
import { PAYER_CHAIN_ID } from "../constants.js";
import { SafeFailure } from "../events.js";

const requiredAgreement = (providerCount: number): number =>
  Math.max(2, Math.floor(providerCount / 2) + 1);

const openProviders = (config: PayerConfig): JsonRpcProvider[] =>
  config.network.rpcUrls.map(
    (url) => new JsonRpcProvider(url, PAYER_CHAIN_ID, { staticNetwork: true }),
  );

const destroyProviders = async (providers: JsonRpcProvider[]): Promise<void> => {
  await Promise.all(providers.map((provider) => provider.destroy()));
};

export const readConservativeLegacyGasPrice = async (
  config: PayerConfig,
): Promise<{ gasPrice: bigint; providerAgreement: number }> => {
  const providers = openProviders(config);
  try {
    const readings = await Promise.all(
      providers.map(async (provider) => {
        try {
          const [network, fees] = await Promise.all([
            provider.getNetwork(),
            provider.getFeeData(),
          ]);
          const gasPrice = fees.gasPrice;
          if (network.chainId !== BigInt(PAYER_CHAIN_ID) || !gasPrice || gasPrice <= 0n) {
            return undefined;
          }
          return gasPrice;
        } catch {
          return undefined;
        }
      }),
    );
    return selectConservativeLegacyGasPrice(readings);
  } finally {
    await destroyProviders(providers);
  }
};

export const selectConservativeLegacyGasPrice = (
  readings: Array<bigint | undefined>,
  minimumAgreement = requiredAgreement(readings.length),
): { gasPrice: bigint; providerAgreement: number } => {
  const healthy = readings.filter((value): value is bigint => value !== undefined && value > 0n);
  if (healthy.length < minimumAgreement) {
    throw new SafeFailure(
      "RPC_UNAVAILABLE",
      "A configured RPC majority must return Arbitrum gas data",
    );
  }
  return {
    gasPrice: healthy.reduce((maximum, value) => (value > maximum ? value : maximum)),
    providerAgreement: healthy.length,
  };
};

export type QuorumReceipt = {
  transactionHash: string;
  blockNumber: number;
  blockHash: string;
  succeeded: boolean;
  providerAgreement: number;
};

const receiptIdentity = (receipt: TransactionReceipt): string =>
  [
    receipt.hash.toLowerCase(),
    receipt.blockNumber,
    receipt.blockHash.toLowerCase(),
    receipt.status,
  ].join(":");

export const selectReceiptQuorum = (
  transactionHash: string,
  receipts: Array<TransactionReceipt | null | undefined>,
  minimumAgreement = requiredAgreement(receipts.length),
): QuorumReceipt | undefined => {
  const groups = new Map<string, TransactionReceipt[]>();
  for (const receipt of receipts) {
    if (
      !receipt ||
      receipt.hash.toLowerCase() !== transactionHash.toLowerCase() ||
      !Number.isSafeInteger(receipt.blockNumber) ||
      receipt.blockNumber < 1 ||
      !/^0x[0-9a-fA-F]{64}$/.test(receipt.blockHash) ||
      (receipt.status !== 0 && receipt.status !== 1)
    ) {
      continue;
    }
    const identity = receiptIdentity(receipt);
    groups.set(identity, [...(groups.get(identity) ?? []), receipt]);
  }
  const winner = [...groups.values()].sort((left, right) => right.length - left.length)[0];
  if (!winner || winner.length < minimumAgreement) return undefined;
  const receipt = winner[0];
  if (!receipt) return undefined;
  return {
    transactionHash: receipt.hash.toLowerCase(),
    blockNumber: receipt.blockNumber,
    blockHash: receipt.blockHash.toLowerCase(),
    succeeded: receipt.status === 1,
    providerAgreement: winner.length,
  };
};

export const readReceiptQuorum = async (
  config: PayerConfig,
  transactionHash: string,
): Promise<QuorumReceipt | undefined> => {
  if (!/^0x[0-9a-fA-F]{64}$/.test(transactionHash)) {
    throw new SafeFailure("REQUEST_INVALID", "Transaction hash is invalid");
  }
  const providers = openProviders(config);
  try {
    const receipts = await Promise.all(
      providers.map(async (provider) => {
        try {
          const network = await provider.getNetwork();
          if (network.chainId !== BigInt(PAYER_CHAIN_ID)) return undefined;
          return await provider.getTransactionReceipt(transactionHash);
        } catch {
          return undefined;
        }
      }),
    );
    return selectReceiptQuorum(transactionHash, receipts);
  } finally {
    await destroyProviders(providers);
  }
};
