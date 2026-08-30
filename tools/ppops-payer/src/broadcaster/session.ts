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

export type PreparedBroadcasterSubmission = {
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
  selected: SelectedBroadcaster,
  minimumReliability: number,
  minimumQuoteValidityMs: number,
  now = Date.now(),
): ValidatedBroadcaster => {
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

  async discover(): Promise<ValidatedBroadcaster> {
    const module = this.requireStarted();
    const chain = NETWORK_CONFIG[PAYER_NETWORK].chain;
    const deadline = Date.now() + this.config.discoveryTimeoutMs;
    while (Date.now() < deadline) {
      const selected = module.WakuBroadcasterClient.findBestBroadcaster(
        chain,
        PAYER_TOKEN_ADDRESS,
        false,
      );
      if (selected) {
        try {
          const validated = validateBroadcaster(
            selected,
            this.config.minimumReliability,
            this.config.minimumQuoteValidityMs,
          );
          const peers = await this.peerCounts();
          if (peers.lightPush > 0 && peers.filter > 0) {
            writeEvent("broadcaster.discovered", {
              reliability: selected.tokenFee.reliability,
              availableWallets: selected.tokenFee.availableWallets,
              quoteValidityMs: selected.tokenFee.expiration - Date.now(),
              lightPushPeers: peers.lightPush,
              filterPeers: peers.filter,
            });
            return validated;
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
    const selected = candidates?.find(
      (candidate: SelectedBroadcaster) =>
        candidate.railgunAddress === expected.selected.railgunAddress &&
        candidate.tokenFee.feesID === expected.selected.tokenFee.feesID &&
        candidate.tokenFee.feePerUnitGas === expected.selected.tokenFee.feePerUnitGas,
    );
    if (!selected) {
      throw new SafeFailure(
        "BROADCASTER_INVALID_QUOTE",
        "The selected Broadcaster quote changed during proof generation",
      );
    }
    return validateBroadcaster(
      selected,
      this.config.minimumReliability,
      this.config.minimumQuoteValidityMs,
    );
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
      return { send: () => transaction.send() };
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
        throw new Error("Broadcaster returned an invalid transaction hash");
      }
      return transactionHash;
    } catch (error) {
      throw new SafeFailure(
        "BROADCASTER_SUBMISSION_FAILED",
        "Broadcaster submission did not return a valid transaction hash",
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
