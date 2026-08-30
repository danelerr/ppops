import { createHash } from "node:crypto";

import {
  BroadcasterConnectionStatus,
  NETWORK_CONFIG,
  POI_REQUIRED_LISTS,
  type PreTransactionPOIsPerTxidLeafPerList,
  type SelectedBroadcaster,
} from "@railgun-community/shared-models";
import { validateRailgunAddress } from "@railgun-community/wallet";

import {
  PAYER_NETWORK,
  PAYER_TOKEN_ADDRESS,
  PAYER_TXID_VERSION,
} from "../constants.js";
import { SafeFailure, writeEvent } from "../events.js";
import type { BroadcasterTrustConfig } from "./config.js";
import {
  BroadcasterAmbiguousResponseFailure,
  BroadcasterRejectedFailure,
  classifyAmbiguousBroadcasterResponse,
  classifyDefinitiveBroadcasterRejection,
} from "./failures.js";

type BroadcasterModule = typeof import("@railgun-community/waku-broadcaster-client-node");

export type BroadcasterPeerCounts = {
  mesh: number;
  pubSub: number;
  lightPush: number;
  filter: number;
};

export type ValidatedBroadcaster = {
  selected: SelectedBroadcaster;
  feePerUnitGas: bigint;
  fingerprint: string;
};

type BroadcasterDiscovery = {
  selected?: ValidatedBroadcaster;
  validQuoteCount: number;
  uniqueBroadcasterCount: number;
  eligibleBroadcasterCount: number;
  excludedBroadcasterCount: number;
};

export type PreparedBroadcasterSubmission = {
  quote: ValidatedBroadcaster;
  send: () => Promise<string>;
};

const delay = async (milliseconds: number): Promise<void> =>
  new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

const withTimeout = async <T>(
  task: Promise<T>,
  milliseconds: number,
  message: string,
): Promise<T> => {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), milliseconds);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
};

const parseFeePerUnitGas = (value: string): bigint => {
  try {
    const parsed = BigInt(value);
    if (parsed <= 0n || parsed >= 2n ** 256n) throw new Error("Fee is out of range");
    return parsed;
  } catch (error) {
    throw new SafeFailure("BROADCASTER_INVALID_QUOTE", "Broadcaster fee quote is invalid", {
      cause: error,
    });
  }
};

export const validateBroadcaster = (
  value: unknown,
  minimumReliability: number,
  minimumQuoteValidityMs: number,
  now = Date.now(),
): ValidatedBroadcaster => {
  if (!value || typeof value !== "object") {
    throw new SafeFailure("BROADCASTER_INVALID_QUOTE", "Broadcaster quote is malformed");
  }
  const candidate = value as Record<string, unknown>;
  const tokenFee = candidate.tokenFee;
  if (
    typeof candidate.railgunAddress !== "string" ||
    typeof candidate.tokenAddress !== "string" ||
    !tokenFee ||
    typeof tokenFee !== "object"
  ) {
    throw new SafeFailure("BROADCASTER_INVALID_QUOTE", "Broadcaster quote is malformed");
  }
  const fee = tokenFee as Record<string, unknown>;
  if (
    typeof fee.feePerUnitGas !== "string" ||
    typeof fee.expiration !== "number" ||
    typeof fee.feesID !== "string" ||
    typeof fee.availableWallets !== "number" ||
    typeof fee.reliability !== "number"
  ) {
    throw new SafeFailure("BROADCASTER_INVALID_QUOTE", "Broadcaster fee quote is malformed");
  }
  const selected = value as SelectedBroadcaster;
  if (
    selected.tokenAddress.toLowerCase() !== PAYER_TOKEN_ADDRESS ||
    !validateRailgunAddress(selected.railgunAddress) ||
    !Number.isSafeInteger(selected.tokenFee.expiration) ||
    selected.tokenFee.expiration < now + minimumQuoteValidityMs ||
    !Number.isSafeInteger(selected.tokenFee.availableWallets) ||
    selected.tokenFee.availableWallets < 1 ||
    !Number.isFinite(selected.tokenFee.reliability) ||
    selected.tokenFee.reliability < minimumReliability ||
    selected.tokenFee.reliability > 1 ||
    !/^[\x21-\x7e]{1,256}$/.test(selected.tokenFee.feesID)
  ) {
    throw new SafeFailure(
      "BROADCASTER_INVALID_QUOTE",
      "Broadcaster identity, availability or quote lifetime is invalid",
    );
  }
  const feePerUnitGas = parseFeePerUnitGas(selected.tokenFee.feePerUnitGas);
  const fingerprint = createHash("sha256")
    .update("ppops-broadcaster:v1:")
    .update(selected.railgunAddress)
    .update(":")
    .update(selected.tokenAddress.toLowerCase())
    .update(":")
    .update(selected.tokenFee.feesID)
    .update(":")
    .update(selected.tokenFee.feePerUnitGas)
    .update(":")
    .update(selected.tokenFee.expiration.toString())
    .digest("hex");
  return { selected, feePerUnitGas, fingerprint };
};

const proofCompatibleQuote = (
  candidate: ValidatedBroadcaster,
  expected: ValidatedBroadcaster,
): boolean =>
  // Fee broadcasts rotate their feesID/expiration in the client cache while
  // the Broadcaster retains earlier fee IDs through their TTL. The generated
  // transfer proof binds the fee recipient/token/amount; with fixed gas details,
  // identical fee-per-gas preserves that amount. Never reuse a proof across an
  // address, token or fee-rate change.
  candidate.selected.railgunAddress.toLowerCase() ===
    expected.selected.railgunAddress.toLowerCase() &&
  candidate.selected.tokenAddress.toLowerCase() ===
    expected.selected.tokenAddress.toLowerCase() &&
  candidate.feePerUnitGas === expected.feePerUnitGas;

export const selectSubmissionBroadcaster = (
  candidates: unknown,
  expected: ValidatedBroadcaster,
  minimumReliability: number,
  minimumQuoteValidityMs: number,
  now = Date.now(),
): ValidatedBroadcaster | undefined => {
  const validatedCandidates: ValidatedBroadcaster[] = [];
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    try {
      const validated = validateBroadcaster(
        candidate,
        minimumReliability,
        minimumQuoteValidityMs,
        now,
      );
      validatedCandidates.push(validated);
    } catch (error) {
      if (!(error instanceof SafeFailure)) throw error;
    }
  }
  return (
    validatedCandidates.find(
      (candidate) => candidate.fingerprint === expected.fingerprint,
    ) ??
    validatedCandidates.find((candidate) =>
      proofCompatibleQuote(candidate, expected),
    )
  );
};

const compareDiscoverableBroadcasters = (
  left: ValidatedBroadcaster,
  right: ValidatedBroadcaster,
): number => {
  if (left.feePerUnitGas !== right.feePerUnitGas) {
    return left.feePerUnitGas < right.feePerUnitGas ? -1 : 1;
  }
  const reliabilityDifference =
    right.selected.tokenFee.reliability - left.selected.tokenFee.reliability;
  if (reliabilityDifference !== 0) return reliabilityDifference;
  return left.fingerprint.localeCompare(right.fingerprint);
};

export const selectDiscoverableBroadcaster = (
  candidates: unknown,
  minimumReliability: number,
  minimumQuoteValidityMs: number,
  excludedRailgunAddresses: readonly string[] = [],
  now = Date.now(),
): BroadcasterDiscovery => {
  const validatedCandidates: ValidatedBroadcaster[] = [];
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    try {
      validatedCandidates.push(
        validateBroadcaster(
          candidate,
          minimumReliability,
          minimumQuoteValidityMs,
          now,
        ),
      );
    } catch (error) {
      if (!(error instanceof SafeFailure)) throw error;
    }
  }

  const excluded = new Set(
    excludedRailgunAddresses.map((address) => address.toLowerCase()),
  );
  const uniqueBroadcasters = new Set(
    validatedCandidates.map((candidate) =>
      candidate.selected.railgunAddress.toLowerCase(),
    ),
  );
  const excludedBroadcasters = new Set(
    [...uniqueBroadcasters].filter((address) => excluded.has(address)),
  );
  const eligibleCandidates = validatedCandidates.filter(
    (candidate) =>
      !excluded.has(candidate.selected.railgunAddress.toLowerCase()),
  );
  const eligibleBroadcasters = new Set(
    eligibleCandidates.map((candidate) =>
      candidate.selected.railgunAddress.toLowerCase(),
    ),
  );

  return {
    selected: [...eligibleCandidates].sort(compareDiscoverableBroadcasters)[0],
    validQuoteCount: validatedCandidates.length,
    uniqueBroadcasterCount: uniqueBroadcasters.size,
    eligibleBroadcasterCount: eligibleBroadcasters.size,
    excludedBroadcasterCount: excludedBroadcasters.size,
  };
};

export class BroadcasterSession {
  private module?: BroadcasterModule;
  private started = false;
  private status: BroadcasterConnectionStatus = BroadcasterConnectionStatus.Disconnected;

  constructor(private readonly config: BroadcasterTrustConfig) {}

  async start(): Promise<void> {
    if (this.started) return;
    let startupTask: Promise<void> | undefined;
    try {
      this.module = await import("@railgun-community/waku-broadcaster-client-node");
      const network = NETWORK_CONFIG[PAYER_NETWORK];
      startupTask = this.module.WakuBroadcasterClient.start(
        network.chain,
        {
          trustedFeeSigner: this.config.trustedFeeSigners,
          poiActiveListKeys: POI_REQUIRED_LISTS.map((list) => list.key),
          pubSubTopic: this.config.pubSubTopic,
          peerDiscoveryTimeout: this.config.peerDiscoveryTimeoutMs,
          feeExpirationTimeout: this.config.feeExpirationTimeoutMs,
          useDNSDiscovery: true,
          broadcasterVersionRange: this.config.broadcasterVersionRange,
        },
        (_chain, status) => {
          this.status = status;
          writeEvent("broadcaster.status", { status });
        },
      );
      await withTimeout(
        startupTask,
        this.config.peerDiscoveryTimeoutMs + 30_000,
        "Broadcaster client startup timed out",
      );
      this.started = true;
    } catch (error) {
      if (this.module) {
        const module = this.module;
        if (startupTask) {
          void startupTask
            .then(async () => {
              await module.WakuBroadcasterClient.stop();
            })
            .catch(() => undefined);
        }
        await withTimeout(
          module.WakuBroadcasterClient.stop(),
          15_000,
          "Broadcaster client cleanup timed out",
        ).catch(() => undefined);
      }
      this.started = false;
      throw new SafeFailure(
        "BROADCASTER_UNAVAILABLE",
        "Unable to start the Waku Broadcaster client",
        { cause: error },
      );
    }
  }

  async stop(): Promise<void> {
    if (!this.module) return;
    try {
      await withTimeout(
        this.module.WakuBroadcasterClient.stop(),
        15_000,
        "Broadcaster client shutdown timed out",
      );
    } catch (error) {
      throw new SafeFailure(
        "BROADCASTER_UNAVAILABLE",
        "Unable to stop the Waku Broadcaster client cleanly",
        { cause: error },
      );
    } finally {
      this.started = false;
    }
  }

  async discover(
    excludedRailgunAddresses: readonly string[] = [],
  ): Promise<ValidatedBroadcaster> {
    const module = this.requireStarted();
    const chain = NETWORK_CONFIG[PAYER_NETWORK].chain;
    const deadline = Date.now() + this.config.discoveryTimeoutMs;
    let previousCandidateSummary: string | undefined;
    while (Date.now() < deadline) {
      const candidates = module.WakuBroadcasterClient.findBroadcastersForToken(
        chain,
        PAYER_TOKEN_ADDRESS,
        false,
      );
      const discovery = selectDiscoverableBroadcaster(
        candidates,
        this.config.minimumReliability,
        this.config.minimumQuoteValidityMs,
        excludedRailgunAddresses,
      );
      const candidateSummary = JSON.stringify({
        validQuoteCount: discovery.validQuoteCount,
        uniqueBroadcasterCount: discovery.uniqueBroadcasterCount,
        eligibleBroadcasterCount: discovery.eligibleBroadcasterCount,
        excludedBroadcasterCount: discovery.excludedBroadcasterCount,
      });
      if (candidateSummary !== previousCandidateSummary) {
        previousCandidateSummary = candidateSummary;
        writeEvent("broadcaster.discovery-candidates", {
          validQuoteCount: discovery.validQuoteCount,
          uniqueBroadcasterCount: discovery.uniqueBroadcasterCount,
          eligibleBroadcasterCount: discovery.eligibleBroadcasterCount,
          excludedBroadcasterCount: discovery.excludedBroadcasterCount,
        });
      }
      if (discovery.selected) {
        try {
          const peers = await this.peerCounts();
          if (peers.lightPush > 0 && peers.filter > 0) {
            writeEvent("broadcaster.discovered", {
              reliability: discovery.selected.selected.tokenFee.reliability,
              availableWallets:
                discovery.selected.selected.tokenFee.availableWallets,
              quoteValidityMs:
                discovery.selected.selected.tokenFee.expiration - Date.now(),
              eligibleBroadcasterCount: discovery.eligibleBroadcasterCount,
              lightPushPeers: peers.lightPush,
              filterPeers: peers.filter,
            });
            return discovery.selected;
          }
        } catch (error) {
          if (!(error instanceof SafeFailure)) throw error;
        }
      }
      await delay(1_000);
    }
    throw new SafeFailure("BROADCASTER_UNAVAILABLE", "No bounded USDC Broadcaster quote became ready");
  }

  async peerCounts(): Promise<BroadcasterPeerCounts> {
    const module = this.requireStarted();
    const [lightPush, filter] = await Promise.all([
      module.WakuBroadcasterClient.getLightPushPeerCount(),
      module.WakuBroadcasterClient.getFilterPeerCount(),
    ]);
    return {
      mesh: module.WakuBroadcasterClient.getMeshPeerCount(),
      pubSub: module.WakuBroadcasterClient.getPubSubPeerCount(),
      lightPush,
      filter,
    };
  }

  assertQuoteStillCurrent(expected: ValidatedBroadcaster): ValidatedBroadcaster {
    const module = this.requireStarted();
    const candidates = module.WakuBroadcasterClient.findBroadcastersForToken(
      NETWORK_CONFIG[PAYER_NETWORK].chain,
      PAYER_TOKEN_ADDRESS,
      false,
    );
    const current = selectSubmissionBroadcaster(
      candidates,
      expected,
      this.config.minimumReliability,
      this.config.minimumQuoteValidityMs,
    );
    if (!current) {
      throw new SafeFailure(
        "BROADCASTER_INVALID_QUOTE",
        "No live Broadcaster quote remains compatible with the generated proof",
      );
    }
    if (current.fingerprint !== expected.fingerprint) {
      writeEvent("broadcaster.quote-rotated-compatible", {
        quoteValidityMs: current.selected.tokenFee.expiration - Date.now(),
      });
    }
    return current;
  }

  connectionStatus(): BroadcasterConnectionStatus {
    return this.status;
  }

  async prepareSubmission(input: {
    selected: ValidatedBroadcaster;
    to: string;
    data: string;
    nullifiers: string[];
    overallBatchMinGasPrice: bigint;
    preTransactionPOIsPerTxidLeafPerList: PreTransactionPOIsPerTxidLeafPerList;
  }): Promise<PreparedBroadcasterSubmission> {
    const module = this.requireStarted();
    const current = this.assertQuoteStillCurrent(input.selected);
    try {
      const transaction = await module.BroadcasterTransaction.create(
        // The pinned payer and merchant both use the V2 Poseidon TXID tree.
        // Keep this value coupled to the transaction proof in the caller.
        PAYER_TXID_VERSION,
        input.to,
        input.data,
        current.selected.railgunAddress,
        current.selected.tokenFee.feesID,
        NETWORK_CONFIG[PAYER_NETWORK].chain,
        input.nullifiers,
        input.overallBatchMinGasPrice,
        false,
        input.preTransactionPOIsPerTxidLeafPerList,
      );
      return { quote: current, send: () => transaction.send() };
    } catch (error) {
      throw new SafeFailure(
        "BROADCASTER_SUBMISSION_FAILED",
        "Unable to prepare the encrypted Broadcaster submission",
        { cause: error },
      );
    }
  }

  async submitPrepared(
    prepared: PreparedBroadcasterSubmission,
  ): Promise<string> {
    try {
      const transactionHash = await prepared.send();
      if (!/^0x[0-9a-fA-F]{64}$/.test(transactionHash)) {
        throw new BroadcasterAmbiguousResponseFailure(
          "INVALID_TRANSACTION_HASH",
        );
      }
      return transactionHash;
    } catch (error) {
      if (
        error instanceof BroadcasterRejectedFailure ||
        error instanceof BroadcasterAmbiguousResponseFailure
      ) {
        throw error;
      }
      const rejectionCode = classifyDefinitiveBroadcasterRejection(error);
      if (rejectionCode) {
        throw new BroadcasterRejectedFailure(rejectionCode, { cause: error });
      }
      const ambiguityCode = classifyAmbiguousBroadcasterResponse(error);
      if (ambiguityCode) {
        throw new BroadcasterAmbiguousResponseFailure(ambiguityCode, {
          cause: error,
        });
      }
      // Once send() starts, an unrecognized client/transport failure cannot
      // prove that the encrypted request never reached the Broadcaster. Keep
      // it in the same conservative, recover-before-retry state as all other
      // chain-ambiguous responses.
      throw new BroadcasterAmbiguousResponseFailure(
        "UNCLASSIFIED_FAILURE",
        { cause: error },
      );
    }
  }

  private requireStarted(): BroadcasterModule {
    if (!this.module || !this.started) {
      throw new SafeFailure("BROADCASTER_UNAVAILABLE", "Broadcaster client is not running");
    }
    return this.module;
  }
}
