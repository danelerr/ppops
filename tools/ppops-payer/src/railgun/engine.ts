import { constants } from "node:fs";
import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { WalletBalanceBucket } from "@railgun-community/engine";
import {
  EVMGasType,
  NETWORK_CONFIG,
  NetworkName,
  type FallbackProviderJsonConfig,
  type MerkletreeScanUpdateEvent,
} from "@railgun-community/shared-models";
import {
  assertValidRailgunAddress,
  awaitWalletScan,
  createRailgunWallet,
  fullWalletForID,
  getProver,
  loadProvider,
  loadWalletByID,
  refreshBalances,
  setOnTXIDMerkletreeScanCallback,
  setOnUTXOMerkletreeScanCallback,
  setOnWalletPOIProofProgressCallback,
  startRailgunEngine,
  stopRailgunEngine,
  unloadProvider,
  type SnarkJSGroth16,
} from "@railgun-community/wallet";
import leveldown, { type LevelDown } from "leveldown";
import { groth16 } from "snarkjs";
import { z } from "zod";

import type { PayerConfig } from "../config.js";
import {
  PAYER_NETWORK,
  PAYER_TOKEN_ADDRESS,
  PAYER_TXID_VERSION,
} from "../constants.js";
import { SafeFailure, writeEvent } from "../events.js";
import { readOwnerOnlyFile } from "../security/private-file.js";
import { createArtifactStore } from "./artifacts.js";

const WalletStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    walletID: z.string().regex(/^[0-9a-f]{64}$/i),
    railgunAddress: z.string().regex(/^0zk\S{32,256}$/),
    walletCreationBlock: z.number().int().positive().safe(),
  })
  .strict();

type WalletState = z.infer<typeof WalletStateSchema>;

export type BalanceSummary = Record<WalletBalanceBucket, string>;

const exists = async (path: string): Promise<boolean> => {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
};

const progressRatio = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;

const withTimeout = async <T>(
  task: Promise<T>,
  milliseconds: number,
  operation: string,
): Promise<T> => {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`${operation} timed out after ${milliseconds} ms`)),
          milliseconds,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
};

export class PayerRailgunEngine {
  readonly network = NETWORK_CONFIG[PAYER_NETWORK];
  private readonly providerConfig: FallbackProviderJsonConfig;
  private engineStarted = false;
  private providerLoaded = false;
  private walletState?: WalletState;

  constructor(
    private readonly config: PayerConfig,
    private readonly dbEncryptionKey: string,
    private readonly mnemonic?: string,
  ) {
    this.providerConfig = {
      chainId: this.network.chain.id,
      providers: config.network.rpcUrls.map((provider, index) => ({
        provider,
        priority: index + 1,
        weight: index === 0 ? 2 : 1,
        stallTimeout: 3_000,
        maxLogsPerBatch: 100,
      })),
    };
  }

  get walletID(): string {
    if (!this.walletState) throw new Error("Payer wallet is not loaded");
    return this.walletState.walletID;
  }

  get railgunAddress(): string {
    if (!this.walletState) throw new Error("Payer wallet is not loaded");
    return this.walletState.railgunAddress;
  }

  async start(): Promise<void> {
    if (this.engineStarted) return;
    await mkdir(dirname(this.config.storage.railgunDbPath), {
      recursive: true,
      mode: 0o700,
    });
    await mkdir(this.config.storage.artifactsPath, { recursive: true, mode: 0o700 });
    const createLevelDown = leveldown as unknown as (location: string) => LevelDown;
    try {
      await startRailgunEngine(
        "ppops-payer",
        createLevelDown(this.config.storage.railgunDbPath),
        false,
        createArtifactStore(this.config.storage.artifactsPath),
        false,
        false,
        this.config.poiNodeUrls,
        [],
        false,
      );
      this.engineStarted = true;
      this.installCallbacks();
      getProver().setSnarkJSGroth16(groth16 as unknown as SnarkJSGroth16);
      this.walletState = await this.loadOrCreateWallet();
      fullWalletForID(this.walletState.walletID);
      assertValidRailgunAddress(this.walletState.railgunAddress);
      await withTimeout(
        loadProvider(
          this.providerConfig,
          PAYER_NETWORK,
          this.config.scanner.providerPollingIntervalMs,
        ),
        90_000,
        "RAILGUN provider load",
      );
      this.providerLoaded = true;
      writeEvent("engine.ready", {
        network: PAYER_NETWORK,
        creationBlock: this.walletState.walletCreationBlock,
      });
    } catch (error) {
      await this.stop().catch(() => undefined);
      throw new SafeFailure("ENGINE_START_FAILED", "RAILGUN payer engine failed to start", {
        cause: error,
      });
    }
  }

  async stop(): Promise<void> {
    let firstError: unknown;
    if (this.providerLoaded) {
      try {
        await withTimeout(
          unloadProvider(PAYER_NETWORK),
          15_000,
          "RAILGUN provider unload",
        );
      } catch (error) {
        firstError = error;
      }
    }
    this.providerLoaded = false;
    if (this.engineStarted) {
      try {
        await withTimeout(stopRailgunEngine(), 15_000, "RAILGUN engine shutdown");
      } catch (error) {
        firstError ??= error;
      }
    }
    this.engineStarted = false;
    this.walletState = undefined;
    if (firstError) throw firstError;
  }

  async syncBalances(): Promise<BalanceSummary> {
    const walletScan = awaitWalletScan(this.walletID, this.network.chain);
    writeEvent("sync.started");
    try {
      await Promise.all([
        refreshBalances(this.network.chain, [this.walletID]),
        walletScan,
      ]);
      const balances = await this.balanceSummary();
      writeEvent("sync.completed", {
        spendableAtomic: balances[WalletBalanceBucket.Spendable],
      });
      return balances;
    } catch (error) {
      throw new SafeFailure("SYNC_FAILED", "RAILGUN balance synchronization failed", {
        cause: error,
      });
    }
  }

  async spendableBalance(): Promise<bigint> {
    const wallet = fullWalletForID(this.walletID);
    return (
      (await wallet.getBalanceERC20(
        PAYER_TXID_VERSION,
        this.network.chain,
        PAYER_TOKEN_ADDRESS,
        [WalletBalanceBucket.Spendable],
      )) ?? 0n
    );
  }

  private async balanceSummary(): Promise<BalanceSummary> {
    const wallet = fullWalletForID(this.walletID);
    const entries = await Promise.all(
      Object.values(WalletBalanceBucket).map(async (bucket) => {
        const amount =
          (await wallet.getBalanceERC20(
            PAYER_TXID_VERSION,
            this.network.chain,
            PAYER_TOKEN_ADDRESS,
            [bucket],
          )) ?? 0n;
        return [bucket, amount.toString()] as const;
      }),
    );
    return Object.fromEntries(entries) as BalanceSummary;
  }

  private installCallbacks(): void {
    const emitScan = (kind: "utxo" | "txid", event: MerkletreeScanUpdateEvent): void => {
      if (event.chain.id !== this.network.chain.id) return;
      writeEvent("sync.progress", {
        kind,
        status: event.scanStatus,
        progressRatio: progressRatio(event.progress),
      });
    };
    setOnUTXOMerkletreeScanCallback((event) => emitScan("utxo", event));
    setOnTXIDMerkletreeScanCallback((event) => emitScan("txid", event));
    setOnWalletPOIProofProgressCallback((event) => {
      if (event.chain.id !== this.network.chain.id) return;
      writeEvent("poi.progress", {
        status: event.status,
        progressRatio: progressRatio(event.progress),
      });
    });
  }

  private async loadOrCreateWallet(): Promise<WalletState> {
    if (await exists(this.config.storage.walletStatePath)) {
      const state = WalletStateSchema.parse(
        JSON.parse(
          await readOwnerOnlyFile(this.config.storage.walletStatePath, {
            label: "Payer wallet state",
            maxBytes: 64 * 1_024,
          }),
        ) as unknown,
      );
      if (state.walletCreationBlock !== this.config.network.walletCreationBlock) {
        throw new Error("Persisted wallet creation block does not match configuration");
      }
      const loaded = await loadWalletByID(this.dbEncryptionKey, state.walletID, false);
      if (loaded.railgunAddress !== state.railgunAddress) {
        throw new Error("Persisted payer wallet identity mismatch");
      }
      return state;
    }
    if (!this.mnemonic) throw new Error("Mnemonic is required for first wallet import");
    const created = await createRailgunWallet(this.dbEncryptionKey, this.mnemonic, {
      [NetworkName.Arbitrum]: this.config.network.walletCreationBlock,
    });
    const state: WalletState = {
      schemaVersion: 1,
      walletID: created.id,
      railgunAddress: created.railgunAddress,
      walletCreationBlock: this.config.network.walletCreationBlock,
    };
    await mkdir(dirname(this.config.storage.walletStatePath), {
      recursive: true,
      mode: 0o700,
    });
    await writeFile(
      this.config.storage.walletStatePath,
      `${JSON.stringify(state, null, 2)}\n`,
      { mode: 0o600, flag: "wx" },
    );
    return state;
  }
}

export { EVMGasType };
