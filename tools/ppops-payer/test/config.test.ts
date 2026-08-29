import { describe, expect, it } from "vitest";

import { PayerConfigSchema } from "../src/config.js";
import {
  PAYER_CHAIN_ID,
  PAYER_DEPLOYMENT_BLOCK,
  PAYER_NETWORK,
  PAYER_TOKEN_ADDRESS,
} from "../src/constants.js";

const config = () => ({
  schemaVersion: 1,
  network: {
    railgunNetworkName: PAYER_NETWORK,
    chainId: PAYER_CHAIN_ID,
    tokenAddress: PAYER_TOKEN_ADDRESS,
    tokenSymbol: "USDC",
    tokenDecimals: 6,
    deploymentBlock: PAYER_DEPLOYMENT_BLOCK,
    walletCreationBlock: 497_727_949,
    rpcUrls: ["https://rpc-a.example", "https://rpc-b.example"],
  },
  poiNodeUrls: ["https://poi.example"],
  storage: {
    railgunDbPath: "./data/db",
    artifactsPath: "./data/artifacts",
    walletStatePath: "./data/state.json",
  },
  secrets: {
    dbEncryptionKeyFile: "./secrets/db-key",
    mnemonicFile: "./secrets/mnemonic",
    selfSigningKeyFile: "./secrets/evm-key",
  },
  scanner: { providerPollingIntervalMs: 10_000 },
});

describe("payer configuration", () => {
  it("accepts only the pinned Arbitrum/native-USDC profile", () => {
    expect(PayerConfigSchema.safeParse(config()).success).toBe(true);
    const wrongToken = config();
    wrongToken.network.tokenAddress = "0x0000000000000000000000000000000000000001";
    expect(PayerConfigSchema.safeParse(wrongToken).success).toBe(false);
  });

  it("requires independent RPC origins", () => {
    const duplicated = config();
    duplicated.network.rpcUrls = [
      "https://rpc.example/key-a",
      "https://rpc.example/key-b",
    ];
    expect(PayerConfigSchema.safeParse(duplicated).success).toBe(false);
  });

  it("rejects embedded URL credentials", () => {
    const rpcCredentials = config();
    rpcCredentials.network.rpcUrls = [
      "https://user:password@rpc-a.example",
      "https://rpc-b.example",
    ];
    expect(PayerConfigSchema.safeParse(rpcCredentials).success).toBe(false);

    const poiCredentials = config();
    poiCredentials.poiNodeUrls = ["https://user:password@poi.example"];
    expect(PayerConfigSchema.safeParse(poiCredentials).success).toBe(false);
  });
});
