import { MaxUint256, Wallet, getAddress } from "ethers";
import { validateRailgunAddress } from "@railgun-community/wallet";

import { SafeFailure } from "./events.js";

export const assertExpectedPayerAddress = (
  actualPayer: string,
  expectedPayer: string,
): void => {
  if (!validateRailgunAddress(expectedPayer) || actualPayer !== expectedPayer) {
    throw new SafeFailure("SECRET_INVALID", "Loaded payer wallet identity does not match");
  }
};

export const assertExpectedSelfSigner = (
  evmPrivateKey: string,
  expectedAddress: string,
): string => {
  let normalizedExpected: string;
  try {
    normalizedExpected = getAddress(expectedAddress);
  } catch {
    throw new SafeFailure("REQUEST_INVALID", "Expected self-signer address is invalid");
  }
  const derived = new Wallet(evmPrivateKey).address;
  if (derived !== normalizedExpected) {
    throw new SafeFailure("SECRET_INVALID", "Self-signing key identity does not match");
  }
  return derived;
};

export const parseGasCostLimit = (value: string): bigint => {
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new SafeFailure("REQUEST_INVALID", "Maximum gas cost must be a positive wei value");
  }
  const parsed = BigInt(value);
  if (parsed > MaxUint256) {
    throw new SafeFailure("REQUEST_INVALID", "Maximum gas cost exceeds uint256");
  }
  return parsed;
};

export const assertGasCostWithinLimit = (
  gasLimit: bigint,
  maxFeePerGas: bigint,
  maximumCost: bigint,
): bigint => {
  const cost = gasLimit * maxFeePerGas;
  if (cost > maximumCost) {
    throw new SafeFailure(
      "GAS_LIMIT_EXCEEDED",
      "Estimated maximum self-signing gas cost exceeds the explicit limit",
    );
  }
  return cost;
};
