import {
  EVMGasType,
  NetworkName,
  calculateGasLimit,
  getEVMGasTypeForTransaction,
  type RailgunERC20AmountRecipient,
  type TransactionGasDetails,
} from "@railgun-community/shared-models";
import {
  gasEstimateForUnprovenTransfer,
  generateTransferProof,
  populateProvedTransfer,
} from "@railgun-community/wallet";
import {
  JsonRpcProvider,
  Wallet,
  getAddress,
  type TransactionRequest,
} from "ethers";

import type { PayerConfig } from "../config.js";
import {
  PAYER_CHAIN_ID,
  PAYER_NETWORK,
  PAYER_TOKEN_ADDRESS,
  PAYER_TXID_VERSION,
} from "../constants.js";
import { SafeFailure, writeEvent } from "../events.js";
import {
  assertExpectedSelfSigner,
  assertGasCostWithinLimit,
  assertRequestStillOpen,
  parseGasCostLimit,
} from "../execution-guards.js";
import type { PaymentRequest } from "../request.js";
import {
  SubmissionJournal,
  submissionJournalPath,
} from "../security/submission-journal.js";
import type { PayerRailgunEngine } from "./engine.js";

type ProviderContext = {
  provider: JsonRpcProvider;
  signer: Wallet;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
};

const selectProvider = async (
  config: PayerConfig,
  privateKey: string,
): Promise<ProviderContext> => {
  for (const url of config.network.rpcUrls) {
    const provider = new JsonRpcProvider(url, PAYER_CHAIN_ID, { staticNetwork: true });
    try {
      const [network, feeData] = await Promise.all([
        provider.getNetwork(),
        provider.getFeeData(),
      ]);
      if (network.chainId !== BigInt(PAYER_CHAIN_ID)) throw new Error("Wrong chain");
      const maxFeePerGas = feeData.maxFeePerGas ?? feeData.gasPrice;
      const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas ?? 0n;
      if (maxFeePerGas === null || maxFeePerGas <= 0n) throw new Error("Missing fee data");
      return {
        provider,
        signer: new Wallet(privateKey, provider),
        maxFeePerGas,
        maxPriorityFeePerGas:
          maxPriorityFeePerGas > maxFeePerGas ? maxFeePerGas : maxPriorityFeePerGas,
      };
    } catch {
      await provider.destroy();
    }
  }
  throw new SafeFailure("RPC_UNAVAILABLE", "No configured RPC provider is healthy");
};

const gasDetails = (
  gasEstimate: bigint,
  context: ProviderContext,
): TransactionGasDetails => ({
  evmGasType: EVMGasType.Type2,
  gasEstimate,
  maxFeePerGas: context.maxFeePerGas,
  maxPriorityFeePerGas: context.maxPriorityFeePerGas,
});

export const sendSelfSignedTransfer = async (input: {
  config: PayerConfig;
  engine: PayerRailgunEngine;
  request: PaymentRequest;
  dbEncryptionKey: string;
  evmPrivateKey: string;
  expectedSelfSigner: string;
  maxGasCostWei: string;
}): Promise<{ transactionHash: string; selfSigner: string; maxGasCostWei: string }> => {
  const { config, engine, request } = input;
  const amount = BigInt(request.amountAtomic);
  const derivedSelfSigner = assertExpectedSelfSigner(
    input.evmPrivateKey,
    input.expectedSelfSigner,
  );
  const gasCostLimit = parseGasCostLimit(input.maxGasCostWei);
  const submissionJournal = new SubmissionJournal(
    submissionJournalPath(config.storage.walletStatePath),
  );
  await submissionJournal.assertUnused(request.id);
  const spendable = await engine.spendableBalance();
  if (spendable < amount) {
    throw new SafeFailure(
      "INSUFFICIENT_PRIVATE_BALANCE",
      "Spendable private USDC is below the requested payment amount",
    );
  }
  const providerContext = await selectProvider(config, input.evmPrivateKey);
  try {
    const expectedGasType = getEVMGasTypeForTransaction(PAYER_NETWORK, true);
    if (expectedGasType !== EVMGasType.Type2) {
      throw new Error("Unexpected Arbitrum self-signing gas type");
    }
    const recipients: RailgunERC20AmountRecipient[] = [
      {
        tokenAddress: PAYER_TOKEN_ADDRESS,
        amount,
        recipientAddress: request.recipient,
      },
    ];
    let estimatedGas: bigint;
    try {
      const estimate = await gasEstimateForUnprovenTransfer(
        PAYER_TXID_VERSION,
        NetworkName.Arbitrum,
        engine.walletID,
        input.dbEncryptionKey,
        request.memo,
        recipients,
        [],
        gasDetails(0n, providerContext),
        undefined,
        true,
      );
      estimatedGas = estimate.gasEstimate;
      writeEvent("transfer.estimated", { gasEstimate: estimatedGas.toString() });
    } catch (error) {
      throw new SafeFailure("PROOF_FAILED", "Transfer gas estimation failed", {
        cause: error,
      });
    }

    try {
      await generateTransferProof(
        PAYER_TXID_VERSION,
        NetworkName.Arbitrum,
        engine.walletID,
        input.dbEncryptionKey,
        false,
        request.memo,
        recipients,
        [],
        undefined,
        true,
        undefined,
        (progress, status) =>
          writeEvent("proof.progress", {
            progressRatio: Number.isFinite(progress)
              ? Math.max(0, Math.min(1, progress))
              : 0,
            status,
          }),
      );
    } catch (error) {
      throw new SafeFailure("PROOF_FAILED", "Transfer proof generation failed", {
        cause: error,
      });
    }

    const transactionGasDetails = gasDetails(estimatedGas, providerContext);
    const boundedGasLimit = calculateGasLimit(estimatedGas);
    const maxGasCostWei = assertGasCostWithinLimit(
      boundedGasLimit,
      providerContext.maxFeePerGas,
      gasCostLimit,
    );
    let gasBalance: bigint;
    try {
      gasBalance = await providerContext.provider.getBalance(derivedSelfSigner);
    } catch (error) {
      throw new SafeFailure("RPC_UNAVAILABLE", "Unable to read self-signing gas balance", {
        cause: error,
      });
    }
    if (gasBalance < maxGasCostWei) {
      throw new SafeFailure(
        "INSUFFICIENT_GAS_BALANCE",
        "Self-signing wallet has insufficient Arbitrum ETH for the bounded gas cost",
      );
    }
    let populated;
    try {
      populated = await populateProvedTransfer(
        PAYER_TXID_VERSION,
        NetworkName.Arbitrum,
        engine.walletID,
        false,
        request.memo,
        recipients,
        [],
        undefined,
        true,
        undefined,
        transactionGasDetails,
      );
    } catch (error) {
      throw new SafeFailure("POPULATE_FAILED", "Proved transfer population failed", {
        cause: error,
      });
    }

    if (!populated.transaction.to || !populated.transaction.data) {
      throw new SafeFailure("POPULATE_FAILED", "Populated transfer is incomplete");
    }
    if (
      getAddress(String(populated.transaction.to)) !==
      getAddress(engine.network.proxyContract)
    ) {
      throw new SafeFailure("POPULATE_FAILED", "Populated transfer target is unexpected");
    }
    if (populated.transaction.value && BigInt(populated.transaction.value) !== 0n) {
      throw new SafeFailure("POPULATE_FAILED", "Private transfer unexpectedly sends ETH");
    }

    const transaction: TransactionRequest = {
      ...populated.transaction,
      from: undefined,
      chainId: PAYER_CHAIN_ID,
      type: EVMGasType.Type2,
      gasLimit: boundedGasLimit,
      maxFeePerGas: providerContext.maxFeePerGas,
      maxPriorityFeePerGas: providerContext.maxPriorityFeePerGas,
    };
    assertRequestStillOpen(request.expiresAt);
    await submissionJournal.reserve(request, derivedSelfSigner);
    try {
      const response = await providerContext.signer.sendTransaction(transaction);
      writeEvent("transfer.submitted", { transactionHash: response.hash });
      await submissionJournal.markSubmitted(request.id, response.hash);
      return {
        transactionHash: response.hash,
        selfSigner: providerContext.signer.address,
        maxGasCostWei: maxGasCostWei.toString(),
      };
    } catch (error) {
      throw new SafeFailure("SUBMISSION_FAILED", "Self-signed transfer submission failed", {
        cause: error,
      });
    }
  } finally {
    await providerContext.provider.destroy();
  }
};
