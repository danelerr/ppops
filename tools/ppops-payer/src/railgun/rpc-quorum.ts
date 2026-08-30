import {
  JsonRpcProvider,
  type FeeData,
  type Network,
  type TransactionReceipt,
} from "ethers";

import type { PayerConfig } from "../config.js";
import { PAYER_CHAIN_ID } from "../constants.js";
import { SafeFailure } from "../events.js";

const requiredAgreement = (providerCount: number): number =>
  Math.max(2, Math.floor(providerCount / 2) + 1);

const RPC_REQUEST_TIMEOUT_MS = 15_000;

export type PayerRpcProviderLike = {
  getNetwork: () => Promise<Network>;
  getFeeData: () => Promise<FeeData>;
  getTransactionReceipt: (hash: string) => Promise<TransactionReceipt | null>;
  destroy: () => void;
};

type RpcReadOptions = {
  providers?: PayerRpcProviderLike[];
  timeoutMs?: number;
};

const openProviders = (config: PayerConfig): PayerRpcProviderLike[] =>
  config.network.rpcUrls.map(
    (url) => new JsonRpcProvider(url, PAYER_CHAIN_ID, { staticNetwork: true }),
  );

const withTimeout = async <T>(task: Promise<T>, timeoutMs: number): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Payer RPC request timed out")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const destroyProviders = (providers: PayerRpcProviderLike[]): void => {
  for (const provider of providers) provider.destroy();
};

export const readConservativeLegacyGasPrice = async (
  config: PayerConfig,
  options: RpcReadOptions = {},
): Promise<{ gasPrice: bigint; providerAgreement: number }> => {
  const providers = options.providers ?? openProviders(config);
  const timeoutMs = options.timeoutMs ?? RPC_REQUEST_TIMEOUT_MS;
  try {
    const readings = await Promise.all(
      providers.map(async (provider) => {
        try {
          const [network, fees] = await withTimeout(
            Promise.all([provider.getNetwork(), provider.getFeeData()]),
            timeoutMs,
          );
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
    destroyProviders(providers);
  }
};

export const selectConservativeLegacyGasPrice = (
  readings: Array<bigint | undefined>,
  minimumAgreement = requiredAgreement(readings.length),
): { gasPrice: bigint; providerAgreement: number } => {
  const healthy = readings
    .filter((value): value is bigint => value !== undefined && value > 0n)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  if (healthy.length < minimumAgreement) {
    throw new SafeFailure(
      "RPC_UNAVAILABLE",
      "A configured RPC majority must return Arbitrum gas data",
    );
  }
  const gasPrice = healthy[Math.floor(healthy.length / 2)];
  if (gasPrice === undefined) {
    throw new SafeFailure("RPC_UNAVAILABLE", "RPC gas-price selection failed");
  }
  return {
    gasPrice,
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
  options: RpcReadOptions = {},
): Promise<QuorumReceipt | undefined> => {
  if (!/^0x[0-9a-fA-F]{64}$/.test(transactionHash)) {
    throw new SafeFailure("REQUEST_INVALID", "Transaction hash is invalid");
  }
  const providers = options.providers ?? openProviders(config);
  const timeoutMs = options.timeoutMs ?? RPC_REQUEST_TIMEOUT_MS;
  try {
    const receipts = await Promise.all(
      providers.map(async (provider) => {
        try {
          return await withTimeout(
            (async () => {
              const network = await provider.getNetwork();
              if (network.chainId !== BigInt(PAYER_CHAIN_ID)) return undefined;
              return provider.getTransactionReceipt(transactionHash);
            })(),
            timeoutMs,
          );
        } catch {
          return undefined;
        }
      }),
    );
    return selectReceiptQuorum(transactionHash, receipts);
  } finally {
    destroyProviders(providers);
  }
};
