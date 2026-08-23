import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  ACTIVE_TXID_VERSIONS,
  POI,
  TokenType,
  type TXO,
  type TXIDVersion as EngineTXIDVersion,
} from "@railgun-community/engine";
import {
  NETWORK_CONFIG,
  NetworkName,
  RailgunWalletBalanceBucket,
} from "@railgun-community/shared-models";
import {
  awaitWalletScan,
  createViewOnlyRailgunWallet,
  getWalletTransactionHistory,
  loadProvider,
  loadWalletByID,
  parseRailgunTokenAddress,
  refreshBalances,
  unloadProvider,
  viewOnlyWalletForID,
} from "@railgun-community/wallet";
import { JsonRpcProvider } from "ethers";

import {
  STATE_ROOT,
  ensureHexSecretFile,
  publicSepoliaProviderConfig,
  readSecretFile,
  startEngine,
  stopEngine,
} from "./kill-test-support.js";

type WalletState = {
  walletID: string;
  railgunAddress: string;
};

type ChainStatus = "OBSERVED" | "CONFIRMED" | "FINALIZED";
type POIStatus = "UNKNOWN" | "PENDING" | "SPENDABLE" | "BLOCKED";

type Settlement = {
  uniqueSettlementId: string;
  chainId: number;
  txidVersion: EngineTXIDVersion;
  tree: number;
  position: number;
  transactionHash: string;
  railgunTxid?: string;
  tokenAddress: string;
  amountAtomic: string;
  blockNumber: number;
  balanceBucket: RailgunWalletBalanceBucket;
  rawPPOIStatuses: Record<string, string>;
  chainStatus: ChainStatus;
  poiStatus: POIStatus;
  memoText?: string;
  reference?: string;
};

const networkName = NetworkName.EthereumSepolia;
const network = NETWORK_CONFIG[networkName];
const viewerRoot = join(STATE_ROOT, "viewer");
const walletStatePath = join(viewerRoot, "wallet.json");
const viewingKeyPath =
  process.env.PPOPS_VIEWING_KEY_FILE ?? join(STATE_ROOT, "fixture.viewing-key");
const encryptionKey = await ensureHexSecretFile(join(viewerRoot, "db.key"));
const expectedReference = process.env.PPOPS_EXPECTED_REFERENCE?.toLowerCase();
// Test-only escape hatch for proving restart/idempotency against an already
// existing public fixture. Production reconciliation remains ppops:v1-only.
const acceptAnyMemoForJournal =
  process.env.PPOPS_KILL_ACCEPT_ANY_MEMO === "1";

const withTimeout = async <T>(
  task: Promise<T>,
  milliseconds: number,
  label: string,
): Promise<T> => {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`${label} timed out after ${milliseconds}ms`)),
          milliseconds,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
};

const loadState = async (): Promise<WalletState | undefined> => {
  try {
    return JSON.parse(await readFile(walletStatePath, "utf8")) as WalletState;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return undefined;
    throw error;
  }
};

const bucketToPOIStatus = (bucket: RailgunWalletBalanceBucket): POIStatus => {
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
      return "UNKNOWN";
  }
};

const parseReference = (memoText: string | undefined): string | undefined => {
  if (!memoText) return undefined;
  const match = /^ppops:v1:(0x[0-9a-f]{64})$/i.exec(memoText);
  return match?.[1]?.toLowerCase();
};

const chainStatusFor = (
  blockNumber: number,
  latestBlock: number,
  finalizedBlock: number | undefined,
): ChainStatus => {
  if (finalizedBlock !== undefined && blockNumber <= finalizedBlock) return "FINALIZED";
  if (blockNumber <= latestBlock) return "CONFIRMED";
  return "OBSERVED";
};

const normalizeTransactionHash = (transactionHash: string): string => {
  const lower = transactionHash.toLowerCase();
  return lower.startsWith("0x") ? lower : `0x${lower}`;
};

const settlementForTXO = (
  txidVersion: EngineTXIDVersion,
  txo: TXO,
  latestBlock: number,
  finalizedBlock: number | undefined,
): Settlement | undefined => {
  if (txo.note.tokenData.tokenType !== TokenType.ERC20 || txo.note.value <= 0n) {
    return undefined;
  }
  const balanceBucket = POI.getBalanceBucket(
    txo,
  ) as unknown as RailgunWalletBalanceBucket;
  const memoText = txo.note.memoText;
  const blockNumber = txo.blockNumber;
  const transactionHash = normalizeTransactionHash(txo.txid);
  return {
    uniqueSettlementId:
      `${network.chain.id}:${txidVersion}:${transactionHash}:` +
      `${txo.tree}:${txo.position}`,
    chainId: network.chain.id,
    txidVersion,
    tree: txo.tree,
    position: txo.position,
    transactionHash,
    railgunTxid: txo.transactCreationRailgunTxid,
    tokenAddress: parseRailgunTokenAddress(txo.note.tokenData.tokenAddress).toLowerCase(),
    amountAtomic: txo.note.value.toString(),
    blockNumber,
    balanceBucket,
    rawPPOIStatuses: txo.poisPerList ?? {},
    chainStatus: chainStatusFor(blockNumber, latestBlock, finalizedBlock),
    poiStatus: bucketToPOIStatus(balanceBucket),
    memoText,
    reference: parseReference(memoText),
  };
};

const safeSettlement = (settlement: Settlement) => ({
  uniqueSettlementId: settlement.uniqueSettlementId,
  chainId: settlement.chainId,
  txidVersion: settlement.txidVersion,
  tree: settlement.tree,
  position: settlement.position,
  transactionHash: settlement.transactionHash,
  railgunTxid: settlement.railgunTxid,
  tokenAddress: settlement.tokenAddress,
  amountAtomic: settlement.amountAtomic,
  blockNumber: settlement.blockNumber,
  balanceBucket: settlement.balanceBucket,
  rawPPOIStatuses: settlement.rawPPOIStatuses,
  chainStatus: settlement.chainStatus,
  poiStatus: settlement.poiStatus,
  memoPresent: settlement.memoText !== undefined && settlement.memoText.length > 0,
  memoDigest: settlement.memoText
    ? createHash("sha256").update(settlement.memoText).digest("hex")
    : undefined,
  ppopsReferenceRecovered: settlement.reference !== undefined,
  expectedReferenceMatched:
    expectedReference === undefined ? undefined : settlement.reference === expectedReference,
});

const eventReferenceFor = (settlement: Settlement): string | undefined => {
  if (settlement.reference) return settlement.reference;
  if (!acceptAnyMemoForJournal || !settlement.memoText) return undefined;
  return `memo-sha256:${createHash("sha256")
    .update(settlement.memoText)
    .digest("hex")}`;
};

await mkdir(viewerRoot, { recursive: true });
await startEngine({
  dbPath: join(viewerRoot, "engine.db"),
  artifactsPath: join(STATE_ROOT, "artifacts"),
  skipMerkletreeScans: false,
  withTestPOINode: true,
});

let providerLoaded = false;
try {
  let walletState = await loadState();
  if (walletState) {
    const loaded = await loadWalletByID(encryptionKey, walletState.walletID, true);
    assert.equal(loaded.railgunAddress, walletState.railgunAddress);
  } else {
    const shareableViewingKey = await readSecretFile(viewingKeyPath);
    const created = await createViewOnlyRailgunWallet(
      encryptionKey,
      shareableViewingKey,
      { [networkName]: network.deploymentBlock },
    );
    walletState = {
      walletID: created.id,
      railgunAddress: created.railgunAddress,
    };
    await writeFile(walletStatePath, JSON.stringify(walletState), { mode: 0o600 });
  }

  const wallet = viewOnlyWalletForID(walletState.walletID);
  await assert.rejects(
    async () => wallet.sign({} as never, encryptionKey),
    /View-Only wallet cannot generate signatures/,
  );

  const providerConfig = publicSepoliaProviderConfig();
  await withTimeout(loadProvider(providerConfig, networkName, 10_000), 90_000, "provider load");
  providerLoaded = true;
  // scanContractHistory returns before the wallet's internally scheduled PPOI
  // refresh is necessarily complete. Wait for WalletDecryptBalancesComplete,
  // which the engine emits only after that refresh resolves.
  const walletScanComplete = awaitWalletScan(walletState.walletID, network.chain);
  await withTimeout(
    refreshBalances(network.chain, [walletState.walletID]),
    600_000,
    "RAILGUN balance scan",
  );
  await withTimeout(walletScanComplete, 600_000, "wallet decrypt/PPOI completion");

  const rpc = new JsonRpcProvider(providerConfig.providers[0]?.provider, network.chain.id);
  const latestBlock = await rpc.getBlockNumber();
  const finalized = await rpc.getBlock("finalized").catch(() => null);
  await rpc.destroy();

  const allTXOs = (
    await Promise.all(
      ACTIVE_TXID_VERSIONS.map(async (txidVersion) => ({
        txidVersion,
        txos: await wallet.TXOs(txidVersion, network.chain),
      })),
    )
  ).flatMap(({ txidVersion, txos }) =>
    txos.map((txo) => ({ txidVersion, txo })),
  );

  const settlements = allTXOs
    .map(({ txidVersion, txo }) =>
      settlementForTXO(
        txidVersion,
        txo,
        latestBlock,
        finalized?.number,
      ),
    )
    .filter((item): item is Settlement => item !== undefined);
  const ppopsSettlements = settlements.filter((item) => item.reference !== undefined);
  const journalCandidates = settlements.filter(
    (item) => eventReferenceFor(item) !== undefined,
  );

  const journal = new DatabaseSync(join(viewerRoot, "events-v2.sqlite"));
  journal.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS emitted_settlements (
      settlement_id TEXT PRIMARY KEY,
      reference TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      emitted_at TEXT NOT NULL
    ) STRICT;
  `);
  const insert = journal.prepare(`
    INSERT OR IGNORE INTO emitted_settlements
      (settlement_id, reference, payload_json, emitted_at)
    VALUES (?, ?, ?, ?)
  `);
  let newlyEmitted = 0;
  for (const settlement of journalCandidates) {
    const reference = eventReferenceFor(settlement);
    assert(reference !== undefined);
    const result = insert.run(
      settlement.uniqueSettlementId,
      reference,
      JSON.stringify(safeSettlement(settlement)),
      new Date().toISOString(),
    );
    newlyEmitted += Number(result.changes);
  }
  const persistedCount = Number(
    (
      journal.prepare("SELECT COUNT(*) AS count FROM emitted_settlements").get() as {
        count: number;
      }
    ).count,
  );
  journal.close();

  const highLevelHistory = await getWalletTransactionHistory(
    network.chain,
    walletState.walletID,
    network.deploymentBlock,
  );
  const report = {
    ok: true,
    sdkVersions: {
      wallet: "10.9.0",
      engine: "9.6.0",
      sharedModels: "8.0.1",
    },
    network: networkName,
    chainId: network.chain.id,
    walletType: "view-only",
    mnemonicAcceptedByReceiver: false,
    signatureGenerationRejected: true,
    viewingKeyPrinted: false,
    latestBlock,
    finalizedBlock: finalized?.number,
    highLevelHistoryItems: highLevelHistory.length,
    receivedERC20TXOs: settlements.length,
    ppopsSettlements: ppopsSettlements.length,
    journalMode: acceptAnyMemoForJournal
      ? "any-memo-kill-test"
      : "ppops-v1-only",
    journalCandidates: journalCandidates.length,
    newlyEmitted,
    persistedEventCount: persistedCount,
    settlements: settlements.map(safeSettlement),
  };
  const reportPath = join(viewerRoot, "scan-report.json");
  await writeFile(reportPath, JSON.stringify(report, null, 2), { mode: 0o600 });

  if (expectedReference !== undefined) {
    assert(
      ppopsSettlements.some((settlement) => settlement.reference === expectedReference),
      "Expected PPOps reference was not recovered by the view-only scanner.",
    );
  }

  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      network: networkName,
      walletType: "view-only",
      receivedERC20TXOs: settlements.length,
      memoBearingTXOs: settlements.filter((item) => item.memoText).length,
      ppopsSettlements: ppopsSettlements.length,
      journalMode: acceptAnyMemoForJournal
        ? "any-memo-kill-test"
        : "ppops-v1-only",
      journalCandidates: journalCandidates.length,
      newlyEmitted,
      persistedEventCount: persistedCount,
      signatureGenerationRejected: true,
      reportPath,
      sensitiveMemoPrinted: false,
    })}\n`,
  );
} finally {
  if (providerLoaded) {
    process.stderr.write("kill-test cleanup: unload provider\n");
    await withTimeout(unloadProvider(networkName), 15_000, "provider unload");
  }
  process.stderr.write("kill-test cleanup: stop engine\n");
  await withTimeout(stopEngine(), 15_000, "engine stop");
  process.stderr.write("kill-test cleanup: complete\n");
}

await new Promise((resolve) => setImmediate(resolve));
const diagnosticProcess = process as NodeJS.Process & {
  _getActiveHandles?: () => Array<{
    constructor?: { name?: string };
    hasRef?: () => boolean;
  }>;
};
const activeHandles = diagnosticProcess._getActiveHandles?.() ?? [];
const activeResources = process.getActiveResourcesInfo();
const lingeringTimeouts = activeResources.filter(
  (resource) => resource === "Timeout",
).length;
process.stderr.write(
  `kill-test active handles: ${JSON.stringify({
    handles: activeHandles.map((handle) => ({
      type: handle.constructor?.name ?? "unknown",
      referenced: handle.hasRef?.(),
    })),
    resources: activeResources,
    lingeringTimeouts,
  })}\n`,
);

// The pinned SDK's promiseTimeout helper leaves its timeout scheduled when the
// winning promise resolves. Cleanup above has completed; terminate this finite
// CLI harness so CI/restart tests are not held open by those SDK-only timers.
if (lingeringTimeouts > 0) {
  process.stderr.write(
    "kill-test cleanup watchdog: exiting after graceful SDK cleanup; " +
      `${lingeringTimeouts} SDK timeout(s) remained scheduled\n`,
  );
  process.exit(0);
}
