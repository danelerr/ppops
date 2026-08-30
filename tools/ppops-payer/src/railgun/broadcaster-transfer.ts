import {
  EVMGasType,
  getEVMGasTypeForTransaction,
  type FeeTokenDetails,
  type RailgunERC20AmountRecipient,
  type TransactionGasDetails,
} from "@railgun-community/shared-models";
import {
  calculateBroadcasterFeeERC20Amount,
  gasEstimateForUnprovenTransfer,
  generateTransferProof,
  populateProvedTransfer,
} from "@railgun-community/wallet";
import { MaxUint256 } from "ethers";

import type { BroadcasterSession } from "../broadcaster/session.js";
import {
  BroadcasterAmbiguousResponseFailure,
  BroadcasterRejectedFailure,
} from "../broadcaster/failures.js";
import type { PayerConfig } from "../config.js";
import {
  PAYER_NETWORK,
  PAYER_TOKEN_ADDRESS,
  PAYER_TXID_VERSION,
} from "../constants.js";
import { SafeFailure, writeEvent } from "../events.js";
import { assertRequestStillOpen } from "../execution-guards.js";
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
import {
  assertPopulatedNullifiers,
  assertPopulatedPrivateTransfer,
} from "./populated-transfer.js";
import {
  readConservativeLegacyGasPrice,
  readReceiptQuorum,
  simulatePopulatedTransferQuorum,
} from "./rpc-quorum.js";

export type BroadcasterTransferResult = {
  transactionHash?: string;
  reportedTransactionHash?: string;
  canonicalTransactionHashResolved: boolean;
  broadcasterFeeAmountAtomic: string;
  gasEstimate: string;
  providerAgreement: number;
  finalSimulationGasEstimate: string;
  finalSimulationProviderAgreement: number;
  quoteReliability: number;
  quoteValidityMs: number;
  receiptStatus: "NOT_SUBMITTED" | "MINED" | "PENDING";
  blockNumber?: number;
};

export const parseBroadcasterFeeLimit = (value: string): bigint => {
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new SafeFailure(
      "REQUEST_INVALID",
      "Maximum Broadcaster fee must be a positive atomic token amount",
    );
  }
  const parsed = BigInt(value);
  if (parsed > MaxUint256) {
    throw new SafeFailure("REQUEST_INVALID", "Maximum Broadcaster fee exceeds uint256");
  }
  return parsed;
};

export const assertBroadcasterFeeWithinLimit = (
  feeAmount: bigint,
  maximumFeeAmount: bigint,
): void => {
  if (feeAmount <= 0n || feeAmount > maximumFeeAmount) {
    throw new SafeFailure(
      "BROADCASTER_FEE_LIMIT_EXCEEDED",
      "Quoted Broadcaster fee is zero or exceeds the explicit limit",
    );
  }
};

const typeOneGasDetails = (
  gasEstimate: bigint,
  gasPrice: bigint,
): TransactionGasDetails => ({
  evmGasType: EVMGasType.Type1,
  gasEstimate,
  gasPrice,
});

const revalidateLiveRequest = async (
  request: PaymentRequest,
  requestSource: string,
  expectedMerchantSigner: string,
): Promise<void> => {
  assertRequestStillOpen(request.expiresAt);
  try {
    assertLivePaymentRequestSource(requestSource);
    const refreshed = verifyPaymentRequest(
      await loadPaymentRequest(requestSource),
      expectedMerchantSigner,
    );
    assertSamePaymentRequest(request, refreshed);
  } catch (error) {
    throw new SafeFailure(
      "REQUEST_INVALID",
      "Live payment request changed while preparing the Broadcaster transfer",
      { cause: error },
    );
  }
};

export const sendBroadcasterTransfer = async (input: {
  config: PayerConfig;
  engine: PayerRailgunEngine;
  session: BroadcasterSession;
  request: PaymentRequest;
  dbEncryptionKey: string;
  maxBroadcasterFeeAtomic: string;
  requestSource: string;
  expectedMerchantSigner: string;
  submit: boolean;
  retryAmbiguous?: boolean;
}): Promise<BroadcasterTransferResult> => {
  const { config, engine, request, session } = input;
  const amount = BigInt(request.amountAtomic);
  const feeLimit = parseBroadcasterFeeLimit(input.maxBroadcasterFeeAtomic);
  const submissionJournal = new SubmissionJournal(
    submissionJournalPath(config.storage.walletStatePath),
  );
  let retryRecord: Awaited<
    ReturnType<SubmissionJournal["assertBroadcasterRetryable"]>
  > | undefined;
  if (input.retryAmbiguous) {
    if (!input.submit) {
      throw new SafeFailure(
        "REQUEST_INVALID",
        "Ambiguous Broadcaster retry is only valid for a submission",
      );
    }
    retryRecord = await submissionJournal.assertBroadcasterRetryable(
      request,
      engine.railgunAddress,
    );
  } else {
    await submissionJournal.assertUnused(request.id);
  }

  const spendable = await engine.spendableBalance();
  if (spendable < amount) {
    throw new SafeFailure(
      "INSUFFICIENT_PRIVATE_BALANCE",
      "Spendable private USDC is below the requested payment amount",
    );
  }
  const expectedGasType = getEVMGasTypeForTransaction(PAYER_NETWORK, false);
  if (expectedGasType !== EVMGasType.Type1) {
    throw new Error("Unexpected Arbitrum Broadcaster gas type");
  }

  const { gasPrice, providerAgreement } =
    await readConservativeLegacyGasPrice(config);
  const attemptedBroadcasterAddresses = retryRecord
    ? [
        retryRecord.broadcasterRailgunAddress,
        ...(retryRecord.broadcasterRetryAttempts ?? []).map(
          (attempt) => attempt.broadcasterRailgunAddress,
        ),
      ].filter((address): address is string => address !== undefined)
    : [];
  const selected = await session.discover(attemptedBroadcasterAddresses);
  const feeTokenDetails: FeeTokenDetails = {
    tokenAddress: PAYER_TOKEN_ADDRESS,
    feePerUnitGas: selected.feePerUnitGas,
  };
  const recipients: RailgunERC20AmountRecipient[] = [
    {
      tokenAddress: PAYER_TOKEN_ADDRESS,
      amount,
      recipientAddress: request.recipient,
    },
  ];

  let gasEstimate: bigint;
  try {
    const estimate = await gasEstimateForUnprovenTransfer(
      PAYER_TXID_VERSION,
      PAYER_NETWORK,
      engine.walletID,
      input.dbEncryptionKey,
      request.memo,
      recipients,
      [],
      typeOneGasDetails(0n, gasPrice),
      feeTokenDetails,
      false,
    );
    gasEstimate = estimate.gasEstimate;
    if (gasEstimate <= 0n) throw new Error("Gas estimate is not positive");
    writeEvent("broadcaster.transfer-estimated", {
      gasEstimate: gasEstimate.toString(),
      providerAgreement,
    });
  } catch (error) {
    if (error instanceof SafeFailure) throw error;
    throw new SafeFailure("PROOF_FAILED", "Broadcaster gas estimation failed", {
      cause: error,
    });
  }

  const transactionGasDetails = typeOneGasDetails(gasEstimate, gasPrice);
  let broadcasterFee: ReturnType<typeof calculateBroadcasterFeeERC20Amount>;
  try {
    broadcasterFee = calculateBroadcasterFeeERC20Amount(
      feeTokenDetails,
      transactionGasDetails,
    );
    if (broadcasterFee.tokenAddress.toLowerCase() !== PAYER_TOKEN_ADDRESS) {
      throw new Error("Broadcaster fee token changed");
    }
  } catch (error) {
    throw new SafeFailure("BROADCASTER_INVALID_QUOTE", "Broadcaster fee is invalid", {
      cause: error,
    });
  }
  assertBroadcasterFeeWithinLimit(broadcasterFee.amount, feeLimit);
  if (spendable < amount + broadcasterFee.amount) {
    throw new SafeFailure(
      "INSUFFICIENT_PRIVATE_BALANCE",
      "Spendable private USDC cannot cover payment plus bounded Broadcaster fee",
    );
  }
  const broadcasterFeeRecipient: RailgunERC20AmountRecipient = {
    tokenAddress: PAYER_TOKEN_ADDRESS,
    amount: broadcasterFee.amount,
    recipientAddress: selected.selected.railgunAddress,
  };

  try {
    await generateTransferProof(
      PAYER_TXID_VERSION,
      PAYER_NETWORK,
      engine.walletID,
      input.dbEncryptionKey,
      false,
      request.memo,
      recipients,
      [],
      broadcasterFeeRecipient,
      false,
      gasPrice,
      (progress, status) =>
        writeEvent("proof.progress", {
          progressRatio: Number.isFinite(progress)
            ? Math.max(0, Math.min(1, progress))
            : 0,
          status,
        }),
    );
  } catch (error) {
    throw new SafeFailure("PROOF_FAILED", "Broadcaster transfer proof generation failed", {
      cause: error,
    });
  }

  let populated;
  try {
    populated = await populateProvedTransfer(
      PAYER_TXID_VERSION,
      PAYER_NETWORK,
      engine.walletID,
      false,
      request.memo,
      recipients,
      [],
      broadcasterFeeRecipient,
      false,
      gasPrice,
      transactionGasDetails,
    );
  } catch (error) {
    throw new SafeFailure("POPULATE_FAILED", "Broadcaster transfer population failed", {
      cause: error,
    });
  }

  const transaction = assertPopulatedPrivateTransfer(
    populated.transaction,
    engine.network.proxyContract,
  );
  const nullifiers = assertPopulatedNullifiers(populated.nullifiers);
  const finalSimulation = await simulatePopulatedTransferQuorum(
    config,
    transaction,
  );
  writeEvent("broadcaster.final-transaction-simulated", {
    gasEstimate: finalSimulation.gasEstimate.toString(),
    providerAgreement: finalSimulation.providerAgreement,
  });
  await revalidateLiveRequest(
    request,
    input.requestSource,
    input.expectedMerchantSigner,
  );
  const current = session.assertQuoteStillCurrent(selected);
  const quoteValidityMs = current.selected.tokenFee.expiration - Date.now();

  if (!input.submit) {
    writeEvent("broadcaster.transfer-prepared", {
      gasEstimate: gasEstimate.toString(),
      broadcasterFeeAmountAtomic: broadcasterFee.amount.toString(),
      quoteValidityMs,
    });
    return {
      broadcasterFeeAmountAtomic: broadcasterFee.amount.toString(),
      gasEstimate: gasEstimate.toString(),
      providerAgreement,
      finalSimulationGasEstimate: finalSimulation.gasEstimate.toString(),
      finalSimulationProviderAgreement: finalSimulation.providerAgreement,
      quoteReliability: current.selected.tokenFee.reliability,
      quoteValidityMs,
      canonicalTransactionHashResolved: false,
      receiptStatus: "NOT_SUBMITTED",
    };
  }

  const preparedSubmission = await session.prepareSubmission({
    selected: current,
    to: transaction.to,
    data: transaction.data,
    nullifiers,
    overallBatchMinGasPrice: gasPrice,
    preTransactionPOIsPerTxidLeafPerList:
      populated.preTransactionPOIsPerTxidLeafPerList,
  });
  const submissionQuote = preparedSubmission.quote;
  const submissionQuoteValidityMs =
    submissionQuote.selected.tokenFee.expiration - Date.now();

  const reservation = {
    payerRailgunAddress: engine.railgunAddress,
    broadcasterRailgunAddress: submissionQuote.selected.railgunAddress,
    broadcasterQuoteFingerprint: submissionQuote.fingerprint,
    broadcasterFeesID: submissionQuote.selected.tokenFee.feesID,
    broadcasterFeeAmountAtomic: broadcasterFee.amount,
    nullifiers,
  };
  try {
    if (input.retryAmbiguous) {
      await submissionJournal.reserveBroadcasterRetry(request, reservation);
    } else {
      await submissionJournal.reserveBroadcaster(request, reservation);
    }
  } catch (error) {
    throw new SafeFailure("JOURNAL_UPDATE_FAILED", "Broadcaster reservation failed", {
      cause: error,
    });
  }

  let reportedTransactionHash: string;
  try {
    reportedTransactionHash = await session.submitPrepared(preparedSubmission);
  } catch (error) {
    if (error instanceof BroadcasterRejectedFailure) {
      try {
        if (input.retryAmbiguous) {
          await submissionJournal.markBroadcasterRetryRejected(
            request.id,
            submissionQuote.fingerprint,
            error.rejectionCode,
          );
        } else {
          await submissionJournal.markRejected(
            request.id,
            error.rejectionCode,
          );
        }
      } catch (journalError) {
        throw new SafeFailure(
          "JOURNAL_UPDATE_FAILED",
          "Broadcaster rejection journal update failed",
          { cause: journalError },
        );
      }
      writeEvent("broadcaster.transfer-rejected", {
        rejectionCode: error.rejectionCode,
        ambiguousPriorAttempt: input.retryAmbiguous === true,
      });
    } else if (error instanceof BroadcasterAmbiguousResponseFailure) {
      try {
        await submissionJournal.markBroadcasterAmbiguous(
          request.id,
          error.ambiguityCode,
          input.retryAmbiguous ? submissionQuote.fingerprint : undefined,
        );
      } catch (journalError) {
        throw new SafeFailure(
          "JOURNAL_UPDATE_FAILED",
          "Broadcaster ambiguity journal update failed",
          { cause: journalError },
        );
      }
      writeEvent("broadcaster.transfer-ambiguous", {
        ambiguityCode: error.ambiguityCode,
        ambiguousPriorAttempt: input.retryAmbiguous === true,
      });
    }
    throw error;
  }
  try {
    await submissionJournal.markBroadcasterReported(
      request.id,
      reportedTransactionHash,
    );
  } catch (error) {
    throw new SafeFailure(
      "JOURNAL_UPDATE_FAILED",
      "Broadcaster reported-hash journal update failed",
      { cause: error },
    );
  }
  writeEvent("broadcaster.transfer-reported", { reportedTransactionHash });

  await engine.syncBalances();
  const transactionHash = await engine.recoverTransactionHashForNullifiers(
    nullifiers,
  );
  if (!transactionHash) {
    writeEvent("broadcaster.transfer-canonical-pending");
    return {
      reportedTransactionHash,
      canonicalTransactionHashResolved: false,
      broadcasterFeeAmountAtomic: broadcasterFee.amount.toString(),
      gasEstimate: gasEstimate.toString(),
      providerAgreement,
      finalSimulationGasEstimate: finalSimulation.gasEstimate.toString(),
      finalSimulationProviderAgreement: finalSimulation.providerAgreement,
      quoteReliability: submissionQuote.selected.tokenFee.reliability,
      quoteValidityMs: submissionQuoteValidityMs,
      receiptStatus: "PENDING",
    };
  }
  if (transactionHash.toLowerCase() !== reportedTransactionHash.toLowerCase()) {
    writeEvent("broadcaster.transfer-reported-hash-mismatch");
  }
  try {
    await submissionJournal.markSubmitted(request.id, transactionHash);
  } catch (error) {
    throw new SafeFailure("JOURNAL_UPDATE_FAILED", "Broadcaster journal update failed", {
      cause: error,
    });
  }
  writeEvent("broadcaster.transfer-submitted", { transactionHash });

  const receipt = await readReceiptQuorum(config, transactionHash);
  if (!receipt) {
    writeEvent("broadcaster.transfer-receipt-pending", { transactionHash });
    return {
      transactionHash,
      reportedTransactionHash,
      canonicalTransactionHashResolved: true,
      broadcasterFeeAmountAtomic: broadcasterFee.amount.toString(),
      gasEstimate: gasEstimate.toString(),
      providerAgreement,
      finalSimulationGasEstimate: finalSimulation.gasEstimate.toString(),
      finalSimulationProviderAgreement: finalSimulation.providerAgreement,
      quoteReliability: submissionQuote.selected.tokenFee.reliability,
      quoteValidityMs: submissionQuoteValidityMs,
      receiptStatus: "PENDING",
    };
  }
  try {
    await submissionJournal.markMined(
      request.id,
      receipt.blockNumber,
      receipt.succeeded,
    );
  } catch (error) {
    throw new SafeFailure("JOURNAL_UPDATE_FAILED", "Broadcaster receipt update failed", {
      cause: error,
    });
  }
  if (!receipt.succeeded) {
    throw new SafeFailure("TRANSACTION_REVERTED", "Broadcaster transfer reverted on-chain");
  }
  writeEvent("broadcaster.transfer-mined", {
    transactionHash,
    blockNumber: receipt.blockNumber,
    providerAgreement: receipt.providerAgreement,
  });
  return {
    transactionHash,
    reportedTransactionHash,
    canonicalTransactionHashResolved: true,
    broadcasterFeeAmountAtomic: broadcasterFee.amount.toString(),
    gasEstimate: gasEstimate.toString(),
    providerAgreement,
    finalSimulationGasEstimate: finalSimulation.gasEstimate.toString(),
    finalSimulationProviderAgreement: finalSimulation.providerAgreement,
    quoteReliability: submissionQuote.selected.tokenFee.reliability,
    quoteValidityMs: submissionQuoteValidityMs,
    receiptStatus: "MINED",
    blockNumber: receipt.blockNumber,
  };
};
