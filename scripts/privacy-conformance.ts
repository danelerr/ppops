import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

import { Wallet } from "ethers";

import type { PPOpsConfig } from "../src/config.js";
import { PPOpsDatabase } from "../src/db/database.js";
import type { NormalizedSettlement } from "../src/domain.js";
import { IntentService } from "../src/intents/service.js";
import { logInfo } from "../src/logging.js";
import { ReconciliationService } from "../src/reconciliation/service.js";

const execute = promisify(execFile);
const repositoryRoot = resolve(import.meta.dirname, "..");
const argumentsList = process.argv.slice(2);
if (
  argumentsList.length !== 0 &&
  !(
    argumentsList.length === 2 &&
    argumentsList[0] === "--output" &&
    argumentsList[1]
  )
) {
  throw new Error("Usage: privacy-conformance.ts [--output <report-path>]");
}
const reportPath = argumentsList[1]
  ? resolve(argumentsList[1])
  : join(repositoryRoot, "artifacts", "privacy-report.json");
const runRoot = await mkdtemp(join(tmpdir(), "ppops-privacy-"));
const invoiceCanary = `TOP_SECRET_INVOICE_${Date.now()}`;
const customerCanary = `SECRET_CUSTOMER_${Date.now()}`;

const runGate = async (script: string): Promise<Record<string, unknown>> => {
  const result = await execute(
    process.execPath,
    ["--import", "tsx", join(repositoryRoot, script)],
    {
      cwd: repositoryRoot,
      env: { ...process.env, PPOPS_KILL_STATE_DIR: join(runRoot, "railgun-gate") },
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
    },
  );
  const line = result.stdout.trim().split("\n").at(-1);
  if (!line) throw new Error(`${script} produced no report`);
  return JSON.parse(line) as Record<string, unknown>;
};

try {
  await runGate("scripts/export-public-fixture-viewing-key.ts");
  const railgunEvidence = await runGate("scripts/encrypted-memo-leaf-gate.ts");
  assert.equal(railgunEvidence.receiverWalletType, "view-only");
  assert.equal(railgunEvidence.receiverStoredMnemonic, false);
  assert.equal(railgunEvidence.signatureGenerationRejected, true);
  assert.equal(railgunEvidence.memoFormatRecovered, true);
  assert.equal(railgunEvidence.opaqueReferenceAbsentFromPublicLeaf, true);
  assert.equal(railgunEvidence.plaintextMemoAbsentFromPublicLeaf, true);
  assert.equal(railgunEvidence.restartRecoveredSameSettlement, true);

  const network: PPOpsConfig["network"] = {
    railgunNetworkName: "Ethereum_Sepolia",
    chainId: 11_155_111,
    tokenAddress: "0x00000000000000000000000000000000000000A1",
    tokenSymbol: "TESTUSD",
    tokenDecimals: 6,
    rpcUrls: ["https://rpc.example"],
    deploymentBlock: 1,
    finality: { mode: "confirmations", confirmations: 3 },
  };
  const database = new PPOpsDatabase(join(runRoot, "app", "ppops.sqlite"));
  const intents = new IntentService(
    database,
    network,
    "0zk-authorized-viewing-receiver",
    Wallet.createRandom().privateKey,
  );
  const intent = await intents.create(
    {
      externalReference: `${invoiceCanary}:${customerCanary}`,
      amountAtomic: "100",
      expiresAt: 2_000,
    },
    1_000,
  );
  const transactionHash = `0x${"56".repeat(32)}`;
  const settlement: NormalizedSettlement = {
    uniqueSettlementId: `${network.chainId}:V2_PoseidonMerkle:${transactionHash}:0:1`,
    chainId: network.chainId,
    txidVersion: "V2_PoseidonMerkle",
    tree: 0,
    position: 1,
    transactionHash,
    tokenAddress: network.tokenAddress.toLowerCase(),
    amountAtomic: "100",
    blockNumber: 100,
    blockTimestamp: 1_500,
    balanceBucket: "Spendable",
    rawPPOIStatuses: { test_list: "Valid" },
    chainStatus: "FINALIZED",
    poiStatus: "SPENDABLE",
    reference: intent.reference,
  };

  let applicationLog = "";
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    applicationLog += chunk.toString();
    return true;
  }) as typeof process.stdout.write;
  try {
    new ReconciliationService(database).reconcile(settlement, 1_600);
    logInfo("privacy.flow.completed", { settlements: 1 });
  } finally {
    process.stdout.write = originalWrite;
  }

  const descriptorArtifact = JSON.stringify(intent.descriptor);
  const outboundEvents = JSON.stringify(database.listEvents());
  assert.equal(database.getIntent(intent.id)?.externalReference, `${invoiceCanary}:${customerCanary}`);
  for (const canary of [invoiceCanary, customerCanary]) {
    assert(!descriptorArtifact.includes(canary));
    assert(!outboundEvents.includes(canary));
    assert(!applicationLog.includes(canary));
  }
  database.close();

  const sourceFiles = [
    "src/railgun/engine.ts",
    "src/railgun/scanner.ts",
    "src/runtime.ts",
    "src/cli.ts",
    "src/api/server.ts",
    "src/pilot/mainnet-gate.ts",
  ];
  const productionSource = (
    await Promise.all(sourceFiles.map((path) => readFile(join(repositoryRoot, path), "utf8")))
  ).join("\n");
  assert(!/createRailgunWallet\s*\(/.test(productionSource));
  assert(!/fromMnemonic\s*\(/.test(productionSource));

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    result: "PASS",
    scope: "PPOps v0.1-R operational metadata and RAILGUN encrypted memo properties",
    tests: {
      commercialCanariesAbsentFromDescriptor: "PASS",
      commercialCanariesAbsentFromOutboundEvents: "PASS",
      commercialCanariesAbsentFromApplicationLogs: "PASS",
      commercialReferenceStoredOnlyInLocalSQLite: "PASS",
      opaqueReferenceAbsentFromPublicRAILGUNLeaf: "PASS",
      plaintextMemoAbsentFromPublicRAILGUNLeaf: "PASS",
      referenceRecoveredByAuthorizedReceiverViewingCapability: "PASS",
      receiverStoresNoMnemonic: "PASS",
      signatureGenerationRejectedByViewOnlyWallet: "PASS",
      productionRuntimeImportsNoMnemonicWalletFactory: "PASS",
      restartRecoveredSameSettlementIdentity: "PASS",
    },
    evidence: {
      railgunGate: "scripts/encrypted-memo-leaf-gate.ts",
      primitiveGateReport: "artifacts/primitive-gate-report.json",
      apiAndEventTests: "test/api-webhook.test.ts",
      reconciliationTests: "test/core.test.ts",
    },
    limitations: [
      "The authenticated local API necessarily receives the commercial reference and SQLite stores it locally.",
      "Sender and authorized receiver viewing capabilities can decrypt the RAILGUN memo.",
      "RPC providers observe network requests and timing; PPOps does not provide network-layer anonymity.",
      "Compromise of the merchant host or viewing key reveals the receiver payment graph.",
    ],
  };
  await mkdir(dirname(reportPath), { recursive: true });
  const temporaryReport = `${reportPath}.${process.pid}.tmp`;
  await writeFile(temporaryReport, `${JSON.stringify(report, null, 2)}\n`, {
    mode: 0o600,
  });
  await rename(temporaryReport, reportPath);
  process.stdout.write(`${JSON.stringify({ ok: true, reportPath, result: "PASS" })}\n`);
} finally {
  await rm(runRoot, { recursive: true, force: true });
}
