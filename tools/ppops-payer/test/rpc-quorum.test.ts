import type { FeeData, Network, TransactionReceipt } from "ethers";
import { describe, expect, it, vi } from "vitest";

import type { PayerConfig } from "../src/config.js";
import {
  readConservativeLegacyGasPrice,
  readReceiptQuorum,
  selectConservativeLegacyGasPrice,
  selectReceiptQuorum,
  type PayerRpcProviderLike,
} from "../src/railgun/rpc-quorum.js";

const TX_HASH = `0x${"11".repeat(32)}`;
const BLOCK_HASH = `0x${"22".repeat(32)}`;
const receipt = (
  blockHash = BLOCK_HASH,
  status = 1,
): TransactionReceipt =>
  ({ hash: TX_HASH, blockNumber: 123, blockHash, status }) as TransactionReceipt;

describe("payer RPC agreement", () => {
  it("uses an upper median gas price from a configured-provider majority", () => {
    expect(selectConservativeLegacyGasPrice([2n, undefined, 5n])).toEqual({
      gasPrice: 5n,
      providerAgreement: 2,
    });
    expect(() => selectConservativeLegacyGasPrice([2n, undefined])).toThrow(/majority/);
    expect(() =>
      selectConservativeLegacyGasPrice([2n, 3n, undefined, undefined]),
    ).toThrow(/majority/);
    expect(selectConservativeLegacyGasPrice([2n, 3n, 4n, 1_000_000n])).toEqual({
      gasPrice: 4n,
      providerAgreement: 4,
    });
  });

  it("requires a majority of identical receipts", () => {
    expect(selectReceiptQuorum(TX_HASH, [receipt(), receipt()])).toMatchObject({
      transactionHash: TX_HASH,
      blockNumber: 123,
      succeeded: true,
      providerAgreement: 2,
    });
    expect(
      selectReceiptQuorum(TX_HASH, [receipt(), receipt(`0x${"33".repeat(32)}`)]),
    ).toBeUndefined();
    expect(
      selectReceiptQuorum(TX_HASH, [receipt(), receipt(), undefined, undefined]),
    ).toBeUndefined();
  });

  it("bounds slow providers while retaining a healthy majority", async () => {
    const never = new Promise<never>(() => undefined);
    const provider = (
      gasPrice: bigint,
      transactionReceipt: TransactionReceipt | null,
      hangs = false,
    ): PayerRpcProviderLike => ({
      getNetwork: vi.fn(async () => ({ chainId: 42_161n }) as Network),
      getFeeData: vi.fn(async () =>
        hangs ? never : ({ gasPrice } as FeeData),
      ),
      getTransactionReceipt: vi.fn(async () =>
        hangs ? never : transactionReceipt,
      ),
      destroy: vi.fn(),
    });
    const providers = [
      provider(2n, receipt()),
      provider(5n, receipt()),
      provider(999_999n, null, true),
    ];
    const config = {
      network: {
        rpcUrls: [
          "https://rpc-one.example",
          "https://rpc-two.example",
          "https://rpc-three.example",
        ],
      },
    } as PayerConfig;

    await expect(
      readConservativeLegacyGasPrice(config, { providers, timeoutMs: 5 }),
    ).resolves.toEqual({ gasPrice: 5n, providerAgreement: 2 });
    await expect(
      readReceiptQuorum(config, TX_HASH, { providers, timeoutMs: 5 }),
    ).resolves.toMatchObject({ transactionHash: TX_HASH, providerAgreement: 2 });
    for (const current of providers) expect(current.destroy).toHaveBeenCalledTimes(2);
  });
});
