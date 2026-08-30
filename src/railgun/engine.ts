import { createHash, timingSafeEqual } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, resolve, sep } from "node:path";

import leveldown, { type LevelDown } from "leveldown";
import {
  MerkletreeScanStatus,
  NETWORK_CONFIG,
  NetworkName,
  type FallbackProviderJsonConfig,
  type MerkletreeScanUpdateEvent,
} from "@railgun-community/shared-models";
import {
  ArtifactStore,
  createViewOnlyRailgunWallet,
  fullWalletForID,
  loadProvider,
  loadWalletByID,
  pauseAllPollingProviders,
  setOnTXIDMerkletreeScanCallback,
  setOnUTXOMerkletreeScanCallback,
  startRailgunEngine,
  stopRailgunEngine,
  unloadProvider,
  viewOnlyWalletForID,
} from "@railgun-community/wallet";
import { z } from "zod";

import type { PPOpsConfig } from "../config.js";
import { readOwnerOnlyFile } from "../security/private-file.js";

type WalletState = {
  schemaVersion: 1;
  walletID: string;
  railgunAddress: string;
  viewingKeyFingerprint: string;
};

export type RailgunMerkletreeProgress = {
  status: MerkletreeScanStatus;
  progressRatio: number;
  updatedAt: number;
};

export type RailgunSyncProgress = {
  utxo?: RailgunMerkletreeProgress;
  txid?: RailgunMerkletreeProgress;
  lastUpdatedAt?: number;
};

type SyncProgressListener = (progress: RailgunSyncProgress) => void;

export const normalizeMerkletreeProgressRatio = (
  progress: number,
  status?: MerkletreeScanStatus,
): number => {
  if (status === MerkletreeScanStatus.Complete) return 1;
  return Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
};

const WalletStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    walletID: z.string().regex(/^[0-9a-f]{64}$/i),
    railgunAddress: z.string().regex(/^0zk\S{32,256}$/),
    viewingKeyFingerprint: z.string().regex(/^[0-9a-f]{64}$/i),
  })
  .strict();

const exists = async (path: string): Promise<boolean> => {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
};

const safeArtifactPath = (root: string, path: string): string => {
  const normalizedRoot = resolve(root);
  const candidate = resolve(normalizedRoot, path);
  if (candidate !== normalizedRoot && !candidate.startsWith(`${normalizedRoot}${sep}`)) {
    throw new Error("RAILGUN artifact path escaped the configured artifact directory");
  }
  return candidate;
};

const artifactStore = (root: string): ArtifactStore =>
  new ArtifactStore(
    async (path) => {
      const target = safeArtifactPath(root, path);
      try {
        return await readFile(target);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        return null;
      }
    },
    async (directory, path, data) => {
      await mkdir(safeArtifactPath(root, directory), { recursive: true, mode: 0o700 });
      await writeFile(safeArtifactPath(root, path), data, { mode: 0o600 });
    },
    async (path) => exists(safeArtifactPath(root, path)),
  );

const networkNameFor = (value: string): NetworkName => {
  if (!Object.values(NetworkName).includes(value as NetworkName)) {
    throw new Error(`Unsupported RAILGUN network name: ${value}`);
  }
  return value as NetworkName;
};

const viewingKeyFingerprint = (viewingKey: string): string =>
  createHash("sha256").update(viewingKey).digest("hex");

const fingerprintsMatch = (left: string, right: string): boolean => {
  const leftBytes = Buffer.from(left, "hex");
  const rightBytes = Buffer.from(right, "hex");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
};

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

export class RailgunViewOnlyEngine {
  readonly networkName: NetworkName;
  readonly network;
  readonly providerConfig: FallbackProviderJsonConfig;
  private providerLoaded = false;
  private engineStarted = false;
  private walletState?: WalletState;
  private syncProgress: RailgunSyncProgress = {};
  private readonly syncProgressListeners = new Set<SyncProgressListener>();

  constructor(
    private readonly config: PPOpsConfig,
    private readonly dbEncryptionKey: string,
    private readonly shareableViewingKey: string,
  ) {
    this.networkName = networkNameFor(config.network.railgunNetworkName);
    this.network = NETWORK_CONFIG[this.networkName];
    if (this.network.chain.id !== config.network.chainId) {
      throw new Error(
        `Configured chainId ${config.network.chainId} does not match ${this.networkName}`,
      );
    }
    if (config.network.deploymentBlock !== this.network.deploymentBlock) {
      throw new Error(
        `deploymentBlock must equal the RAILGUN deployment block ${this.network.deploymentBlock}`,
      );
    }
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
    if (!this.walletState) throw new Error("RAILGUN view-only engine is not started");
    return this.walletState.walletID;
  }

  get railgunAddress(): string {
    if (!this.walletState) throw new Error("RAILGUN view-only engine is not started");
    return this.walletState.railgunAddress;
  }

  syncProgressSnapshot(): RailgunSyncProgress {
    return {
      ...(this.syncProgress.utxo ? { utxo: { ...this.syncProgress.utxo } } : {}),
      ...(this.syncProgress.txid ? { txid: { ...this.syncProgress.txid } } : {}),
      ...(this.syncProgress.lastUpdatedAt !== undefined
        ? { lastUpdatedAt: this.syncProgress.lastUpdatedAt }
        : {}),
    };
  }

  onSyncProgress(listener: SyncProgressListener): () => void {
    this.syncProgressListeners.add(listener);
    return () => this.syncProgressListeners.delete(listener);
  }

  async start(): Promise<void> {
    if (this.engineStarted) return;
    await mkdir(dirname(this.config.storage.railgunDbPath), {
      recursive: true,
      mode: 0o700,
    });
    await mkdir(this.config.storage.artifactsPath, { recursive: true, mode: 0o700 });
    const createLevelDown = leveldown as unknown as (location: string) => LevelDown;
    await startRailgunEngine(
      "PPOps",
      createLevelDown(this.config.storage.railgunDbPath),
      false,
      artifactStore(this.config.storage.artifactsPath),
      false,
      false,
      this.config.scanner.poiNodeUrls.length > 0
        ? this.config.scanner.poiNodeUrls
        : undefined,
      [],
      false,
    );
    this.engineStarted = true;
    setOnUTXOMerkletreeScanCallback((event) => this.updateSyncProgress("utxo", event));
    setOnTXIDMerkletreeScanCallback((event) => this.updateSyncProgress("txid", event));

    try {
      this.walletState = await this.loadOrCreateWallet();
      const wallet = viewOnlyWalletForID(this.walletState.walletID);
      try {
        fullWalletForID(this.walletState.walletID);
        throw new Error("RAILGUN unexpectedly exposed the view-only wallet as a full wallet");
      } catch (error) {
        if (!(error instanceof Error) || !/View-Only wallet/.test(error.message)) throw error;
      }
      try {
        await wallet.sign({} as never, this.dbEncryptionKey);
        throw new Error("RAILGUN view-only wallet unexpectedly generated a signature");
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !/View-Only wallet cannot generate signatures/.test(error.message)
        ) {
          throw error;
        }
      }

      await withTimeout(
        loadProvider(
          this.providerConfig,
          this.networkName,
          this.config.scanner.providerPollingIntervalMs,
        ),
        90_000,
        "RAILGUN provider load",
      );
      this.providerLoaded = true;
      // PPOps owns the reconciliation scan schedule. Leaving the SDK polling
      // provider active can overlap our explicit scan and launch untracked,
      // delayed TXID syncs that outlive LevelDB during shutdown.
      pauseAllPollingProviders();
    } catch (error) {
      await this.stop().catch(() => undefined);
      throw error;
    }
  }

  async stop(): Promise<void> {
    let firstError: unknown;
    try {
      if (this.providerLoaded) {
        await withTimeout(unloadProvider(this.networkName), 15_000, "RAILGUN provider unload");
      }
    } catch (error) {
      firstError = error;
    } finally {
      this.providerLoaded = false;
      if (this.engineStarted) {
        try {
          await withTimeout(stopRailgunEngine(), 15_000, "RAILGUN engine shutdown");
        } catch (error) {
          firstError ??= error;
        }
        this.engineStarted = false;
        this.walletState = undefined;
        this.syncProgress = {};
      }
    }
    if (firstError) throw firstError;
  }

  private updateSyncProgress(
    kind: "utxo" | "txid",
    event: MerkletreeScanUpdateEvent,
  ): void {
    if (event.chain.id !== this.network.chain.id) return;
    const updatedAt = Math.floor(Date.now() / 1_000);
    const progressRatio = normalizeMerkletreeProgressRatio(
      event.progress,
      event.scanStatus,
    );
    this.syncProgress = {
      ...this.syncProgress,
      [kind]: { status: event.scanStatus, progressRatio, updatedAt },
      lastUpdatedAt: updatedAt,
    };
    const snapshot = this.syncProgressSnapshot();
    for (const listener of this.syncProgressListeners) listener(snapshot);
  }

  private async loadOrCreateWallet(): Promise<WalletState> {
    const fingerprint = viewingKeyFingerprint(this.shareableViewingKey);
    let state: WalletState | undefined;
    try {
      state = WalletStateSchema.parse(
        JSON.parse(
          await readOwnerOnlyFile(this.config.storage.walletStatePath, {
            label: "RAILGUN wallet state",
            maxBytes: 64 * 1_024,
          }),
        ) as unknown,
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    if (state) {
      if (state.schemaVersion !== 1 || !fingerprintsMatch(state.viewingKeyFingerprint, fingerprint)) {
        throw new Error("Configured viewing key does not match the persisted RAILGUN wallet");
      }
      const loaded = await loadWalletByID(this.dbEncryptionKey, state.walletID, true);
      if (loaded.railgunAddress !== state.railgunAddress) {
        throw new Error("Persisted RAILGUN wallet identity mismatch");
      }
      return state;
    }

    const created = await createViewOnlyRailgunWallet(
      this.dbEncryptionKey,
      this.shareableViewingKey,
      { [this.networkName]: this.config.network.deploymentBlock },
    );
    const createdState: WalletState = {
      schemaVersion: 1,
      walletID: created.id,
      railgunAddress: created.railgunAddress,
      viewingKeyFingerprint: fingerprint,
    };
    await mkdir(dirname(this.config.storage.walletStatePath), {
      recursive: true,
      mode: 0o700,
    });
    await writeFile(
      this.config.storage.walletStatePath,
      `${JSON.stringify(createdState, null, 2)}\n`,
      { mode: 0o600, flag: "wx" },
    );
    return createdState;
  }
}

export { withTimeout };
