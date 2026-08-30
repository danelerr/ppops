import {
  NETWORK_CONFIG,
  NetworkName,
  TXIDVersion,
} from "@railgun-community/shared-models";

export const PAYER_NETWORK = NetworkName.Arbitrum;
export const PAYER_CHAIN_ID = 42_161;
export const PAYER_TOKEN_ADDRESS =
  "0xaf88d065e77c8cc2239327c5edb3a432268e5831";
export const PAYER_TOKEN_SYMBOL = "USDC";
export const PAYER_TOKEN_DECIMALS = 6;
export const PAYER_TXID_VERSION = TXIDVersion.V2_PoseidonMerkle;
// RAILGUN wallet sources are limited to 16 lowercase letters, numerals and spaces.
export const PAYER_WALLET_SOURCE = "ppopspayer";

const railgunNetwork = NETWORK_CONFIG[PAYER_NETWORK];
if (railgunNetwork.chain.id !== PAYER_CHAIN_ID) {
  throw new Error("Pinned RAILGUN Arbitrum profile has an unexpected chain ID");
}

export const PAYER_DEPLOYMENT_BLOCK = railgunNetwork.deploymentBlock;
