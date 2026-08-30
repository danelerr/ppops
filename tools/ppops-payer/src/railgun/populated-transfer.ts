import { getAddress, isHexString, type TransactionRequest } from "ethers";

import { SafeFailure } from "../events.js";

export type ValidatedPopulatedTransfer = {
  to: string;
  data: string;
};

export const assertPopulatedNullifiers = (
  nullifiers: string[] | undefined,
): string[] => {
  if (!nullifiers || nullifiers.length < 1 || nullifiers.length > 64) {
    throw new SafeFailure("POPULATE_FAILED", "Populated transfer has no bounded nullifier set");
  }
  const normalized = nullifiers.map((value) => value.toLowerCase());
  if (
    normalized.some(
      (value) =>
        !/^0x[0-9a-f]{64}$/.test(value) || value === `0x${"0".repeat(64)}`,
    ) ||
    new Set(normalized).size !== normalized.length
  ) {
    throw new SafeFailure("POPULATE_FAILED", "Populated transfer nullifiers are invalid");
  }
  return normalized;
};

export const assertPopulatedPrivateTransfer = (
  transaction: TransactionRequest,
  proxyContract: string,
): ValidatedPopulatedTransfer => {
  if (
    !transaction.to ||
    typeof transaction.data !== "string" ||
    transaction.data === "0x" ||
    !isHexString(transaction.data)
  ) {
    throw new SafeFailure("POPULATE_FAILED", "Populated transfer is incomplete");
  }
  try {
    const to = getAddress(String(transaction.to));
    if (to !== getAddress(proxyContract)) {
      throw new SafeFailure("POPULATE_FAILED", "Populated transfer target is unexpected");
    }
    if (
      transaction.value !== undefined &&
      transaction.value !== null &&
      BigInt(transaction.value) !== 0n
    ) {
      throw new SafeFailure("POPULATE_FAILED", "Private transfer unexpectedly sends ETH");
    }
    return { to, data: transaction.data };
  } catch (error) {
    if (error instanceof SafeFailure) throw error;
    throw new SafeFailure("POPULATE_FAILED", "Populated transfer fields are invalid", {
      cause: error,
    });
  }
};
