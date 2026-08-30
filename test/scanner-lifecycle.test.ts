import { ChainType } from "@railgun-community/shared-models";
import { describe, expect, it, vi } from "vitest";

import type { PPOpsConfig } from "../src/config.js";
import type { RailgunViewOnlyEngine } from "../src/railgun/engine.js";

const walletMocks = vi.hoisted(() => ({
  refreshBalances: vi.fn(async () => undefined),
  txos: vi.fn(async () => []),
}));

vi.mock("@railgun-community/wallet", () => ({
  parseRailgunTokenAddress: (address: string) => address,
  refreshBalances: walletMocks.refreshBalances,
  viewOnlyWalletForID: () => ({ TXOs: walletMocks.txos }),
}));

import { RailgunScanner } from "../src/railgun/scanner.js";

const config = (): PPOpsConfig => ({
  schemaVersion: 1,
  server: {
    host: "127.0.0.1",
    port: 8787,
    allowRemote: false,
    rateLimit: {
      apiPerMinute: 120,
      authFailuresPerMinute: 20,
      checkoutPerMinute: 120,
    },
  },
  network: {
    railgunNetworkName: "Ethereum_Sepolia",
    chainId: 11_155_111,
    tokenAddress: "0x00000000000000000000000000000000000000a1",
    tokenSymbol: "TESTUSD",
    tokenDecimals: 6,
    rpcUrls: ["https://rpc.example"],
    deploymentBlock: 5_784_866,
    finality: { mode: "confirmations", confirmations: 3 },
  },
  storage: {
    sqlitePath: "./data/ppops.sqlite",
    railgunDbPath: "./data/railgun-db",
    artifactsPath: "./data/artifacts",
    walletStatePath: "./data/wallet.json",
  },
  secrets: {
    apiTokenFile: "./secrets/api-token",
    merchantSigningKeyFile: "./secrets/merchant-key",
    railgunDbEncryptionKeyFile: "./secrets/db-key",
    viewingKeyFile: "./secrets/viewing-key",
  },
  scanner: {
    intervalMs: 30_000,
    poiNodeUrls: ["https://poi.example"],
    providerPollingIntervalMs: 10_000,
    rpcTimeoutMs: 1_000,
    maxRpcBlockLag: 5,
    finalizedRecheckSeconds: 604_800,
    maxScanStalenessMs: 900_000,
    scanStallThresholdMs: 1_200_000,
  },
});

describe("RAILGUN scanner lifecycle", () => {
  it("starts a fresh progress window before the owned balance refresh", async () => {
    const beginSyncProgress = vi.fn();
    const engine = {
      walletID: "wallet-id",
      beginSyncProgress,
      network: { chain: { type: ChainType.EVM, id: 11_155_111 } },
    } as unknown as RailgunViewOnlyEngine;
    const scanner = new RailgunScanner(engine, config());
    Object.assign(scanner as unknown as Record<string, unknown>, {
      rpc: {
        chainContext: vi.fn(async () => ({ latestBlock: 100 })),
        close: vi.fn(async () => undefined),
      },
    });

    await expect(scanner.scan()).resolves.toEqual([]);
    expect(beginSyncProgress).toHaveBeenCalledOnce();
    expect(walletMocks.refreshBalances).toHaveBeenCalledOnce();
    expect(beginSyncProgress.mock.invocationCallOrder[0]).toBeLessThan(
      walletMocks.refreshBalances.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    );
  });
});
