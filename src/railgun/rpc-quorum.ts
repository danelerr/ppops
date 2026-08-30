import {
  JsonRpcProvider,
  type Block,
  type TransactionReceipt,
} from "ethers";

export type RpcProviderLike = Pick<
  JsonRpcProvider,
  "getBlockNumber" | "getBlock" | "getTransactionReceipt" | "send" | "destroy"
>;

type RpcQuorumOptions = {
  chainId: number;
  rpcUrls: string[];
  timeoutMs: number;
  maxBlockLag: number;
  providers?: RpcProviderLike[];
};

type ChainContext = { latestBlock: number; finalizedBlock?: number };

const QUORUM_ATTEMPTS = 2;
const QUORUM_RETRY_DELAY_MS = 250;

const waitForQuorumRetry = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, QUORUM_RETRY_DELAY_MS));

const timeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("RPC request exceeded the configured timeout")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const blockKey = (block: Block | null): string =>
  block
    ? `${block.number}:${block.hash ?? "null"}:${block.timestamp}`
    : "null";

const receiptKey = (receipt: TransactionReceipt | null): string =>
  receipt
    ? `${receipt.hash.toLowerCase()}:${receipt.blockNumber}:` +
      `${receipt.blockHash.toLowerCase()}:${receipt.index}:${receipt.status}`
    : "null";

export class RpcQuorum {
  private readonly providers: RpcProviderLike[];
  private readonly quorum: number;
  private chainVerified = false;

  constructor(private readonly options: RpcQuorumOptions) {
    this.providers =
      options.providers ??
      options.rpcUrls.map(
        (url) =>
          new JsonRpcProvider(url, options.chainId, {
            staticNetwork: true,
          }),
      );
    if (this.providers.length === 0) throw new Error("RPC quorum requires a provider");
    this.quorum = Math.floor(this.providers.length / 2) + 1;
  }

  async chainContext(useFinalizedTag: boolean): Promise<ChainContext> {
    await this.assertChainId();
    const latestBlock = await this.consensusHeight(
      "latest block",
      (provider) => provider.getBlockNumber(),
    );
    if (!useFinalizedTag) return { latestBlock };
    const finalizedHeight = await this.consensusHeight(
      "finalized block",
      async (provider) => {
        const block = await provider.getBlock("finalized");
        if (!block) throw new Error("RPC omitted the finalized block");
        return block.number;
      },
    );
    await this.getBlock(finalizedHeight);
    return { latestBlock, finalizedBlock: finalizedHeight };
  }

  async assertChainId(): Promise<void> {
    if (this.chainVerified) return;
    const chainId = await this.consensusValue(
      "chain ID",
      (provider) => provider.send("eth_chainId", []),
      (value) => String(value).toLowerCase(),
    );
    let parsed: bigint;
    try {
      parsed = BigInt(String(chainId));
    } catch {
      throw new Error("RPC quorum returned an invalid chain ID");
    }
    if (parsed !== BigInt(this.options.chainId)) {
      throw new Error("RPC quorum chain ID does not match PPOps configuration");
    }
    this.chainVerified = true;
  }

  async getTransactionReceipt(hash: string): Promise<TransactionReceipt | null> {
    return this.consensusValue(
      "transaction receipt",
      (provider) => provider.getTransactionReceipt(hash),
      receiptKey,
    );
  }

  async getBlock(blockNumber: number): Promise<Block> {
    const block = await this.consensusValue(
      `block ${blockNumber}`,
      (provider) => provider.getBlock(blockNumber),
      blockKey,
    );
    if (!block) throw new Error(`RPC quorum omitted block ${blockNumber}`);
    return block;
  }

  async close(): Promise<void> {
    await Promise.all(
      this.providers.map(async (provider) => {
        await provider.destroy();
      }),
    );
  }

  private async consensusValue<T>(
    label: string,
    operation: (provider: RpcProviderLike) => Promise<T>,
    keyFor: (value: T) => string,
  ): Promise<T> {
    for (let attempt = 1; attempt <= QUORUM_ATTEMPTS; attempt += 1) {
      const results = await Promise.allSettled(
        this.providers.map((provider) =>
          timeout(operation(provider), this.options.timeoutMs),
        ),
      );
      const groups = new Map<string, T[]>();
      for (const result of results) {
        if (result.status !== "fulfilled") continue;
        const key = keyFor(result.value);
        groups.set(key, [...(groups.get(key) ?? []), result.value]);
      }
      const winner = [...groups.values()].sort(
        (left, right) => right.length - left.length,
      )[0];
      if (winner && winner.length >= this.quorum) {
        const value = winner[0];
        if (value === undefined) throw new Error(`RPC quorum returned no ${label}`);
        return value;
      }
      if (attempt < QUORUM_ATTEMPTS) await waitForQuorumRetry();
    }
    throw new Error(`RPC quorum could not agree on ${label}`);
  }

  private async consensusHeight(
    label: string,
    operation: (provider: RpcProviderLike) => Promise<number>,
  ): Promise<number> {
    for (let attempt = 1; attempt <= QUORUM_ATTEMPTS; attempt += 1) {
      const results = await Promise.allSettled(
        this.providers.map((provider) =>
          timeout(operation(provider), this.options.timeoutMs),
        ),
      );
      const heights = results
        .filter(
          (result): result is PromiseFulfilledResult<number> =>
            result.status === "fulfilled",
        )
        .map((result) => result.value)
        .filter((height) => Number.isSafeInteger(height) && height >= 0)
        .sort((left, right) => left - right);
      for (let start = 0; start < heights.length; start += 1) {
        const base = heights[start];
        if (base === undefined) continue;
        const cluster = heights.filter(
          (height) => height >= base && height - base <= this.options.maxBlockLag,
        );
        if (cluster.length >= this.quorum) return base;
      }
      if (attempt < QUORUM_ATTEMPTS) await waitForQuorumRetry();
    }
    throw new Error(`RPC quorum could not agree on ${label}`);
  }
}
