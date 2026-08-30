import { MaxUint256, Signature, Wallet, getAddress, keccak256 } from "ethers";
import {
  getShieldPrivateKeySignatureMessage,
  mnemonicTo0xPKey,
  validateRailgunAddress,
} from "@railgun-community/wallet";

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

export const deriveExpectedSelfSigningKey = (
  mnemonic: string,
  derivationIndex: number,
  expectedAddress: string,
): { privateKey: string; address: string; derivationPath: string } => {
  if (
    !Number.isSafeInteger(derivationIndex) ||
    derivationIndex < 0 ||
    derivationIndex > 1_000
  ) {
    throw new SafeFailure(
      "REQUEST_INVALID",
      "Self-signing derivation index must be between 0 and 1000",
    );
  }
  let privateKey: string;
  try {
    privateKey = mnemonicTo0xPKey(mnemonic, derivationIndex);
  } catch (error) {
    throw new SafeFailure("SECRET_INVALID", "Unable to derive the self-signing key", {
      cause: error,
    });
  }
  const address = assertExpectedSelfSigner(privateKey, expectedAddress);
  return {
    privateKey,
    address,
    derivationPath: `m/44'/60'/0'/0/${derivationIndex}`,
  };
};

/**
 * RAILGUN shielding does not consume the 65-byte EVM signature directly.
 * The SDK expects the 32-byte keccak256 digest of a signature over its fixed
 * ownership marker. Keep this derivation in one tested boundary so callers
 * cannot accidentally pass raw spending material or an incorrectly sized key.
 */
export const deriveShieldPrivateKey = async (signer: {
  signMessage(message: string): Promise<string>;
}): Promise<string> => {
  try {
    const signature = await signer.signMessage(getShieldPrivateKeySignatureMessage());
    Signature.from(signature);
    return keccak256(signature);
  } catch (error) {
    throw new SafeFailure("SECRET_INVALID", "Unable to derive the RAILGUN shield key", {
      cause: error,
    });
  }
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

export const assertRequestStillOpen = (
  expiresAt: number,
  now = Math.floor(Date.now() / 1_000),
): void => {
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) {
    throw new SafeFailure(
      "REQUEST_INVALID",
      "Payment request expired while preparing the transfer",
    );
  }
};
