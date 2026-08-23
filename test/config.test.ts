import { describe, expect, it } from "vitest";

import { PPOpsConfigSchema } from "../src/config.js";

const validConfig = () => ({
  schemaVersion: 1,
  server: { host: "127.0.0.1", port: 8787, allowRemote: false },
  network: {
    railgunNetworkName: "Ethereum_Sepolia",
    chainId: 11_155_111,
    tokenAddress: "0x00000000000000000000000000000000000000A1",
    tokenSymbol: "TESTUSD",
    tokenDecimals: 6,
    rpcUrls: ["https://rpc.example"],
    deploymentBlock: 5_784_866,
    finality: { mode: "confirmations", confirmations: 12 },
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
  },
});

describe("secure configuration defaults", () => {
  it("does not mistake a hostname beginning with 127 for loopback", () => {
    const config = validConfig();
    config.server.host = "127.attacker.example";
    expect(PPOpsConfigSchema.safeParse(config).success).toBe(false);
  });

  it("rejects the zero address as a payment token", () => {
    const config = validConfig();
    config.network.tokenAddress = "0x0000000000000000000000000000000000000000";
    expect(PPOpsConfigSchema.safeParse(config).success).toBe(false);
  });

  it("requires HTTPS for a non-loopback webhook", () => {
    const config = {
      ...validConfig(),
      webhook: {
        url: "http://merchant.example/webhook",
        timeoutMs: 1_000,
        maxAttempts: 3,
        baseRetryMs: 1_000,
        maxRetryMs: 10_000,
      },
      secrets: {
        ...validConfig().secrets,
        webhookHmacKeyFile: "./secrets/webhook-key",
      },
    };
    expect(PPOpsConfigSchema.safeParse(config).success).toBe(false);
  });
});
