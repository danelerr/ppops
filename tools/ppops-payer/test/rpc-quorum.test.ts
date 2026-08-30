import type { TransactionReceipt } from "ethers";
import { describe, expect, it } from "vitest";

import {
  selectConservativeLegacyGasPrice,
  selectReceiptQuorum,
} from "../src/railgun/rpc-quorum.js";

const TX_HASH = `0x${"11".repeat(32)}`;
const BLOCK_HASH = `0x${"22".repeat(32)}`;
const receipt = (
  blockHash = BLOCK_HASH,
  status = 1,
): TransactionReceipt =>
  ({ hash: TX_HASH, blockNumber: 123, blockHash, status }) as TransactionReceipt;

describe("payer RPC agreement", () => {
  it("uses the highest gas price from a configured-provider majority", () => {
    expect(selectConservativeLegacyGasPrice([2n, undefined, 5n])).toEqual({
      gasPrice: 5n,
      providerAgreement: 2,
    });
    expect(() => selectConservativeLegacyGasPrice([2n, undefined])).toThrow(/majority/);
    expect(() =>
      selectConservativeLegacyGasPrice([2n, 3n, undefined, undefined]),
    ).toThrow(/majority/);
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
});
