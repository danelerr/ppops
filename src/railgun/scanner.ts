import {
  ACTIVE_TXID_VERSIONS,
  POI,
  TokenType,
  type TXO,
  type TXIDVersion as EngineTXIDVersion,
} from "@railgun-community/engine";
import { RailgunWalletBalanceBucket } from "@railgun-community/shared-models";
import {
  awaitWalletScan,
  parseRailgunTokenAddress,
  refreshBalances,
  viewOnlyWalletForID,
} from "@railgun-community/wallet";
import type { TransactionReceipt } from "ethers";

import type { PPOpsConfig } from "../config.js";
import {
  parsePPOpsReference,
  type ChainStatus,
  type NormalizedSettlement,
  type POIStatus,
  type SettlementRecord,
} from "../domain.js";
import { RailgunViewOnlyEngine } from "./engine.js";
import { RpcQuorum } from "./rpc-quorum.js";

const normalizeTransactionHash = (transactionHash: string): string => {
  const lower = transactionHash.toLowerCase();
  return lower.startsWith("0x") ? lower : `0x${lower}`;
};

const rawStatusesFor = (txo: TXO): Record<string, string> =>
  Object.fromEntries(
    Object.entries(txo.poisPerList ?? {}).map(([list, status]) => [list, String(status)]),
  );

const mapWithConcurrency = async <Input, Output>(
  inputs: Input[],
  concurrency: number,
  operation: (input: Input) => Promise<Output>,
): Promise<Output[]> => {
  const outputs = new Array<Output>(inputs.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, inputs.length) },
    async () => {
      while (cursor < inputs.length) {
        const index = cursor;
        cursor += 1;
        const input = inputs[index];
        if (input === undefined) continue;
        outputs[index] = await operation(input);
      }
    },
  );
  await Promise.all(workers);
  return outputs;
};

export const bucketToPOIStatus = (
  bucket: RailgunWalletBalanceBucket,
  rawStatuses: Record<string, string>,
): POIStatus => {
  switch (bucket) {
    case RailgunWalletBalanceBucket.Spendable:
      return "SPENDABLE";
    case RailgunWalletBalanceBucket.ShieldBlocked:
      return "BLOCKED";
    case RailgunWalletBalanceBucket.ShieldPending:
    case RailgunWalletBalanceBucket.ProofSubmitted:
    case RailgunWalletBalanceBucket.MissingInternalPOI:
    case RailgunWalletBalanceBucket.MissingExternalPOI:
      return "PENDING";
    case RailgunWalletBalanceBucket.Spent:
      return Object.values(rawStatuses).some((status) => status === "Valid")
        ? "SPENDABLE"
        : "UNKNOWN";
    default:
      return "UNKNOWN";
  }
};

export class RailgunScanner {
  private readonly rpc: RpcQuorum;
  private scanning = false;

  constructor(
    private readonly engine: RailgunViewOnlyEngine,
    private readonly config: PPOpsConfig,
  ) {
    this.rpc = new RpcQuorum({
      chainId: config.network.chainId,
      rpcUrls: config.network.rpcUrls,
      timeoutMs: config.scanner.rpcTimeoutMs,
      maxBlockLag: config.scanner.maxRpcBlockLag,
    });
  }

  async scan(): Promise<NormalizedSettlement[]> {
    if (this.scanning) throw new Error("A RAILGUN scan is already in progress");
    this.scanning = true;
    try {
      const wallet = viewOnlyWalletForID(this.engine.walletID);
      const walletScanComplete = awaitWalletScan(
        this.engine.walletID,
        this.engine.network.chain,
      );
      // refreshBalances cannot be cancelled. Timing it out would only reject the
      // wrapper while the SDK scan keeps running, allowing the daemon to start
      // overlapping scans against the same LevelDB cache. Keep exactly one scan
      // alive and expose its progress through the engine callbacks instead.
      await Promise.all([
        refreshBalances(this.engine.network.chain, [this.engine.walletID]),
        walletScanComplete,
      ]);

      const txos = (
        await Promise.all(
          ACTIVE_TXID_VERSIONS.map(async (txidVersion) => ({
            txidVersion,
            txos: await wallet.TXOs(txidVersion, this.engine.network.chain),
          })),
        )
      ).flatMap(({ txidVersion, txos }) =>
        txos.map((txo) => ({ txidVersion, txo })),
      );
      const referenceTXOs = txos.filter(({ txo }) => {
        if (txo.note.tokenData.tokenType !== TokenType.ERC20 || txo.note.value <= 0n) {
          return false;
        }
        return parsePPOpsReference(txo.note.memoText) !== undefined;
      });
      const chainContext = await this.chainContext();
      const blockTimestampCache = new Map<number, Promise<number>>();
      return mapWithConcurrency(
        referenceTXOs,
        8,
        ({ txidVersion, txo }) =>
          this.normalizeTXO(txidVersion, txo, chainContext, blockTimestampCache),
      );
    } finally {
      this.scanning = false;
    }
  }

  async refreshKnownChainState(
    settlement: SettlementRecord,
  ): Promise<NormalizedSettlement> {
    const chainContext = await this.chainContext();
    const receipt = await this.rpc.getTransactionReceipt(settlement.transactionHash);
    if (!receipt || receipt.status !== 1) {
      return { ...settlement, chainStatus: "REVERTED" };
    }
    const block = await this.rpc.getBlock(receipt.blockNumber);
    return {
      ...settlement,
      blockNumber: receipt.blockNumber,
      blockTimestamp: block.timestamp,
      chainStatus: this.chainStatusFor(receipt, chainContext),
    };
  }

  async close(): Promise<void> {
    await this.rpc.close();
  }

  private async normalizeTXO(
    txidVersion: EngineTXIDVersion,
    txo: TXO,
    chainContext: { latestBlock: number; finalizedBlock?: number },
    timestampCache: Map<number, Promise<number>>,
  ): Promise<NormalizedSettlement> {
    const reference = parsePPOpsReference(txo.note.memoText);
    if (!reference) throw new Error("normalizeTXO received a note without a PPOps reference");
    const transactionHash = normalizeTransactionHash(txo.txid);
    const receipt = await this.rpc.getTransactionReceipt(transactionHash);
    const blockNumber = receipt?.blockNumber ?? txo.blockNumber;
    let timestampPromise = timestampCache.get(blockNumber);
    if (!timestampPromise) {
      timestampPromise = this.rpc.getBlock(blockNumber).then((block) => block.timestamp);
      timestampCache.set(blockNumber, timestampPromise);
    }
    const rawPPOIStatuses = rawStatusesFor(txo);
    const balanceBucket = POI.getBalanceBucket(
      txo,
    ) as unknown as RailgunWalletBalanceBucket;
    return {
      uniqueSettlementId:
        `${this.config.network.chainId}:${txidVersion}:${transactionHash}:` +
        `${txo.tree}:${txo.position}`,
      chainId: this.config.network.chainId,
      txidVersion,
      tree: txo.tree,
      position: txo.position,
      transactionHash,
      ...(txo.transactCreationRailgunTxid
        ? { railgunTxid: txo.transactCreationRailgunTxid }
        : {}),
      tokenAddress: parseRailgunTokenAddress(
        txo.note.tokenData.tokenAddress,
      ).toLowerCase(),
      amountAtomic: txo.note.value.toString(),
      blockNumber,
      blockTimestamp: await timestampPromise,
      balanceBucket,
      rawPPOIStatuses,
      chainStatus: receipt && receipt.status === 1
        ? this.chainStatusFor(receipt, chainContext)
        : "REVERTED",
      poiStatus: bucketToPOIStatus(balanceBucket, rawPPOIStatuses),
      reference,
    };
  }

  private async chainContext(): Promise<{ latestBlock: number; finalizedBlock?: number }> {
    return this.rpc.chainContext(this.config.network.finality.mode === "finalized");
  }

  private chainStatusFor(
    receipt: TransactionReceipt,
    context: { latestBlock: number; finalizedBlock?: number },
  ): ChainStatus {
    if (this.config.network.finality.mode === "finalized") {
      return context.finalizedBlock !== undefined && receipt.blockNumber <= context.finalizedBlock
        ? "FINALIZED"
        : "CONFIRMED";
    }
    const confirmations = context.latestBlock - receipt.blockNumber + 1;
    if (confirmations >= this.config.network.finality.confirmations) return "FINALIZED";
    if (confirmations >= 1) return "CONFIRMED";
    return "OBSERVED";
  }
}
