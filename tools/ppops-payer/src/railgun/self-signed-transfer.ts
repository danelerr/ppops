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
  Transaction,
  Wallet,
  getAddress,
  isError,
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
import {
  assertLivePaymentRequestSource,
  assertSamePaymentRequest,
  loadPaymentRequest,
  verifyPaymentRequest,
  type PaymentRequest,
} from "../request.js";
import {
  SubmissionJournal,
  submissionJournalPath,
} from "../security/submission-journal.js";
import type { PayerRailgunEngine } from "./engine.js";
import { assertPopulatedPrivateTransfer } from "./populated-transfer.js";

type ProviderContext = {
  provider: JsonRpcProvider;
  signer: Wallet;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
};

const RECEIPT_WAIT_TIMEOUT_MS = 120_000;

const readFeeData = async (
  provider: JsonRpcProvider,
): Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }> => {
  const feeData = await provider.getFeeData();
  const maxFeePerGas = feeData.maxFeePerGas ?? feeData.gasPrice;
  const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas ?? 0n;
  if (maxFeePerGas === null || maxFeePerGas <= 0n) {
    throw new Error("Missing fee data");
  }
  return {
    maxFeePerGas,
    maxPriorityFeePerGas:
      maxPriorityFeePerGas > maxFeePerGas ? maxFeePerGas : maxPriorityFeePerGas,
  };
};

const selectProvider = async (
  config: PayerConfig,
  privateKey: string,
): Promise<ProviderContext> => {
  for (const url of config.network.rpcUrls) {
    const provider = new JsonRpcProvider(url, PAYER_CHAIN_ID, { staticNetwork: true });
    try {
      const [network, fees] = await Promise.all([
        provider.getNetwork(),
        readFeeData(provider),
      ]);
      if (network.chainId !== BigInt(PAYER_CHAIN_ID)) throw new Error("Wrong chain");
      return {
        provider,
        signer: new Wallet(privateKey, provider),
        ...fees,
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

export const buildBoundedSelfSignedTransaction = (input: {
  populatedTransaction: TransactionRequest;
  proxyContract: string;
  gasLimit: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  nonce: number;
}): TransactionRequest => {
  const transaction = input.populatedTransaction;
  assertPopulatedPrivateTransfer(transaction, input.proxyContract);
  return {
    ...transaction,
    from: undefined,
    gasPrice: undefined,
    chainId: PAYER_CHAIN_ID,
    type: EVMGasType.Type2,
    gasLimit: input.gasLimit,
    maxFeePerGas: input.maxFeePerGas,
    maxPriorityFeePerGas: input.maxPriorityFeePerGas,
    nonce: input.nonce,
  };
};

export const signBoundedSelfSignedTransaction = async (
  signer: Pick<Wallet, "signTransaction">,
  transaction: TransactionRequest,
  expectedSigner: string,
  expectedNonce: number,
): Promise<{ signedTransaction: string; transactionHash: string }> => {
  const signedTransaction = await signer.signTransaction(transaction);
  const parsed = Transaction.from(signedTransaction);
  if (
    !parsed.hash ||
    parsed.from !== getAddress(expectedSigner) ||
    parsed.nonce !== expectedNonce ||
    parsed.chainId !== BigInt(PAYER_CHAIN_ID) ||
    parsed.type !== EVMGasType.Type2
  ) {
    throw new Error("Signed transaction identity mismatch");
  }
  return { signedTransaction, transactionHash: parsed.hash };
};

const recordReceipt = async (
  journal: SubmissionJournal,
  intentId: string,
  blockNumber: number,
  succeeded: boolean,
): Promise<void> => {
  try {
    await journal.markMined(intentId, blockNumber, succeeded);
  } catch (error) {
    throw new SafeFailure("JOURNAL_UPDATE_FAILED", "Receipt journal update failed", {
      cause: error,
    });
  }
};

export const sendSelfSignedTransfer = async (input: {
  config: PayerConfig;
  engine: PayerRailgunEngine;
  request: PaymentRequest;
  dbEncryptionKey: string;
  evmPrivateKey: string;
  expectedSelfSigner: string;
  maxGasCostWei: string;
  requestSource: string;
  expectedMerchantSigner: string;
  submit: boolean;
}): Promise<{
  transactionHash?: string;
  selfSigner: string;
  maxGasCostWei: string;
  receiptStatus: "NOT_SUBMITTED" | "MINED" | "PENDING";
  blockNumber?: number;
}> => {
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

    let refreshedFees: Awaited<ReturnType<typeof readFeeData>>;
    try {
      refreshedFees = await readFeeData(providerContext.provider);
    } catch (error) {
      throw new SafeFailure("RPC_UNAVAILABLE", "Unable to refresh transaction fees", {
        cause: error,
      });
    }
    const refreshedProviderContext: ProviderContext = {
      ...providerContext,
      ...refreshedFees,
    };
    const transactionGasDetails = gasDetails(estimatedGas, refreshedProviderContext);
    const boundedGasLimit = calculateGasLimit(estimatedGas);
    const maxGasCostWei = assertGasCostWithinLimit(
      boundedGasLimit,
      refreshedProviderContext.maxFeePerGas,
      gasCostLimit,
    );
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

    assertRequestStillOpen(request.expiresAt);
    try {
      assertLivePaymentRequestSource(input.requestSource);
      const refreshed = verifyPaymentRequest(
        await loadPaymentRequest(input.requestSource),
        input.expectedMerchantSigner,
      );
      assertSamePaymentRequest(request, refreshed);
    } catch (error) {
      throw new SafeFailure(
        "REQUEST_INVALID",
        "Live payment request changed while preparing the transfer",
        { cause: error },
      );
    }
    let gasBalance: bigint;
    let nonce: number;
    try {
      [gasBalance, nonce] = await Promise.all([
        providerContext.provider.getBalance(derivedSelfSigner),
        providerContext.provider.getTransactionCount(derivedSelfSigner, "pending"),
      ]);
    } catch (error) {
      throw new SafeFailure("RPC_UNAVAILABLE", "Unable to read self-signing account state", {
        cause: error,
      });
    }
    if (gasBalance < maxGasCostWei) {
      throw new SafeFailure(
        "INSUFFICIENT_GAS_BALANCE",
        "Self-signing wallet has insufficient Arbitrum ETH for the bounded gas cost",
      );
    }
    const transaction = buildBoundedSelfSignedTransaction({
      populatedTransaction: populated.transaction,
      proxyContract: engine.network.proxyContract,
      gasLimit: boundedGasLimit,
      maxFeePerGas: refreshedProviderContext.maxFeePerGas,
      maxPriorityFeePerGas: refreshedProviderContext.maxPriorityFeePerGas,
      nonce,
    });
    if (!input.submit) {
      writeEvent("transfer.prepared", {
        gasEstimate: estimatedGas.toString(),
        maxGasCostWei: maxGasCostWei.toString(),
      });
      return {
        selfSigner: providerContext.signer.address,
        maxGasCostWei: maxGasCostWei.toString(),
        receiptStatus: "NOT_SUBMITTED",
      };
    }
    let signedTransaction: string;
    let transactionHash: string;
    try {
      ({ signedTransaction, transactionHash } = await signBoundedSelfSignedTransaction(
        providerContext.signer,
        transaction,
        derivedSelfSigner,
        nonce,
      ));
    } catch (error) {
      throw new SafeFailure("POPULATE_FAILED", "Unable to sign the bounded transaction", {
        cause: error,
      });
    }
    await submissionJournal.reserve(
      request,
      derivedSelfSigner,
      transactionHash,
      nonce,
    );
    let response;
    try {
      response = await providerContext.provider.broadcastTransaction(signedTransaction);
      if (response.hash !== transactionHash) {
        throw new Error("RPC returned a different transaction hash");
      }
      writeEvent("transfer.submitted", { transactionHash });
    } catch (error) {
      throw new SafeFailure("SUBMISSION_FAILED", "Self-signed transfer submission failed", {
        cause: error,
      });
    }
    try {
      await submissionJournal.markSubmitted(request.id, transactionHash);
    } catch (error) {
      throw new SafeFailure("JOURNAL_UPDATE_FAILED", "Submission journal update failed", {
        cause: error,
      });
    }

    try {
      const receipt = await response.wait(1, RECEIPT_WAIT_TIMEOUT_MS);
      if (!receipt) {
        writeEvent("transfer.receipt-pending", { transactionHash });
        return {
          transactionHash,
          selfSigner: providerContext.signer.address,
          maxGasCostWei: maxGasCostWei.toString(),
          receiptStatus: "PENDING",
        };
      }
      await recordReceipt(
        submissionJournal,
        request.id,
        receipt.blockNumber,
        receipt.status === 1,
      );
      if (receipt.status !== 1) {
        throw new SafeFailure("TRANSACTION_REVERTED", "Private transfer reverted on-chain");
      }
      writeEvent("transfer.mined", {
        transactionHash,
        blockNumber: receipt.blockNumber,
      });
      return {
        transactionHash,
        selfSigner: providerContext.signer.address,
        maxGasCostWei: maxGasCostWei.toString(),
        receiptStatus: "MINED",
        blockNumber: receipt.blockNumber,
      };
    } catch (error) {
      if (error instanceof SafeFailure) throw error;
      if (isError(error, "TIMEOUT")) {
        writeEvent("transfer.receipt-pending", { transactionHash });
        return {
          transactionHash,
          selfSigner: providerContext.signer.address,
          maxGasCostWei: maxGasCostWei.toString(),
          receiptStatus: "PENDING",
        };
      }
      if (isError(error, "CALL_EXCEPTION") && error.receipt) {
        await recordReceipt(
          submissionJournal,
          request.id,
          error.receipt.blockNumber,
          false,
        );
        throw new SafeFailure("TRANSACTION_REVERTED", "Private transfer reverted on-chain", {
          cause: error,
        });
      }
      if (isError(error, "TRANSACTION_REPLACED")) {
        throw new SafeFailure("TRANSACTION_REPLACED", "Private transfer was replaced", {
          cause: error,
        });
      }
      throw new SafeFailure("RECEIPT_UNAVAILABLE", "Unable to confirm the submitted transfer", {
        cause: error,
      });
    }
  } finally {
    await providerContext.provider.destroy();
  }
};
