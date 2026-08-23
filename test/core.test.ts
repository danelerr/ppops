import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Wallet } from "ethers";
import { afterEach, describe, expect, it } from "vitest";

import type { PPOpsConfig } from "../src/config.js";
import { PPOpsDatabase } from "../src/db/database.js";
import {
  memoForReference,
  parsePPOpsReference,
  type NormalizedSettlement,
} from "../src/domain.js";
import { IntentService } from "../src/intents/service.js";
import { ReconciliationService } from "../src/reconciliation/service.js";
import {
  createSignedDescriptor,
  verifySignedDescriptor,
} from "../src/security/descriptor.js";

const roots: string[] = [];

const testRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), "ppops-test-"));
  roots.push(root);
  return root;
};

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

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

const services = (path = join(testRoot(), "ppops.sqlite")) => {
  const database = new PPOpsDatabase(path);
  const privateKey = Wallet.createRandom().privateKey;
  const intents = new IntentService(database, network, "0zk-test-receiver", privateKey);
  const reconciliation = new ReconciliationService(database);
  return { database, intents, reconciliation, privateKey, path };
};

let candidateIndex = 0;
const candidate = (
  reference: string,
  amountAtomic: string,
  overrides: Partial<NormalizedSettlement> = {},
): NormalizedSettlement => {
  candidateIndex += 1;
  const suffix = candidateIndex.toString(16).padStart(64, "0");
  const transactionHash = `0x${suffix}`;
  return {
    uniqueSettlementId: `${network.chainId}:V2_PoseidonMerkle:${transactionHash}:0:${candidateIndex}`,
    chainId: network.chainId,
    txidVersion: "V2_PoseidonMerkle",
    tree: 0,
    position: candidateIndex,
    transactionHash,
    tokenAddress: network.tokenAddress.toLowerCase(),
    amountAtomic,
    blockNumber: 100 + candidateIndex,
    blockTimestamp: 1_500,
    balanceBucket: "Spendable",
    rawPPOIStatuses: { test_list: "Valid" },
    chainStatus: "FINALIZED",
    poiStatus: "SPENDABLE",
    reference,
    ...overrides,
  };
};

describe("signed payment descriptor", () => {
  it("requires an independently trusted merchant signer", async () => {
    const signer = Wallet.createRandom();
    const descriptor = await createSignedDescriptor(
      {
        chainId: network.chainId,
        tokenAddress: network.tokenAddress,
        decimals: 6,
        amountAtomic: "1000000",
        recipient0zk: "0zk-test-receiver",
        reference: `0x${"ab".repeat(32)}`,
        expiresAt: 2_000,
      },
      signer.privateKey,
    );
    expect(verifySignedDescriptor(descriptor, signer.address)).toBe(signer.address);
    expect(() => verifySignedDescriptor(descriptor, Wallet.createRandom().address)).toThrow(
      /independently trusted/,
    );
    expect(() =>
      verifySignedDescriptor(
        { ...descriptor, unexpected: "field" } as typeof descriptor,
        signer.address,
      ),
    ).toThrow();
  });

  it("accepts only the strict opaque memo format", () => {
    const reference = `0x${"12".repeat(32)}`;
    expect(parsePPOpsReference(memoForReference(reference))).toBe(reference);
    expect(parsePPOpsReference(`invoice:INV-4932:${reference}`)).toBeUndefined();
    expect(parsePPOpsReference(`ppops:v1:${reference}:extra`)).toBeUndefined();
  });
});

describe("reconciliation", () => {
  it("replays an idempotent intent after expiry without creating a duplicate", async () => {
    const { database, intents } = services();
    const input = {
      externalReference: "INV-IDEMPOTENT",
      amountAtomic: "10",
      expiresAt: 2_000,
    };
    const created = await intents.createIdempotent(input, "merchant-key-0001", 1_000);
    const replayed = await intents.createIdempotent(input, "merchant-key-0001", 3_000);
    expect(created.replayed).toBe(false);
    expect(replayed).toMatchObject({ replayed: true });
    expect(replayed.intent.id).toBe(created.intent.id);
    expect(database.listIntents()).toHaveLength(1);
    const storedKey = database.sqlite
      .prepare("SELECT idempotency_key FROM intent_idempotency")
      .pluck()
      .get();
    expect(storedKey).toMatch(/^[0-9a-f]{64}$/);
    expect(storedKey).not.toBe("merchant-key-0001");
    database.close();
  });

  it("handles partial and overpayment and is exact-once across restart", async () => {
    const { database, intents, reconciliation, path } = services();
    const intent = await intents.create(
      { externalReference: "INV-PRIVATE-1", amountAtomic: "100", expiresAt: 2_000 },
      1_000,
    );
    const first = candidate(intent.reference, "70");
    reconciliation.reconcile(first, 1_510);
    expect(intents.requireView(intent.id)).toMatchObject({
      status: "PARTIAL",
      receivedAmountAtomic: "70",
      overpaymentAmountAtomic: "0",
    });
    expect(database.listEvents().map((event) => event.type)).toEqual([
      "settlement.observed",
      "payment.partial",
    ]);

    reconciliation.reconcile(first, 1_520);
    expect(database.listEvents()).toHaveLength(2);
    database.close();

    const reopened = new PPOpsDatabase(path);
    const restartedReconciliation = new ReconciliationService(reopened);
    restartedReconciliation.reconcile(first, 1_530);
    expect(reopened.listEvents()).toHaveLength(2);

    const second = candidate(intent.reference, "50");
    restartedReconciliation.reconcile(second, 1_540);
    expect(reopened.getProjection(intent.id)).toMatchObject({
      status: "PAID",
      receivedAmountAtomic: "120",
      overpaymentAmountAtomic: "20",
    });
    expect(
      reopened.listEvents().filter((event) => event.type === "payment.confirmed"),
    ).toHaveLength(1);
    reopened.close();
  });

  it("does not credit a settlement before both finality and PPOI spendability", async () => {
    const { database, intents, reconciliation } = services();
    const intent = await intents.create(
      { externalReference: "INV-PENDING", amountAtomic: "100", expiresAt: 3_000 },
      1_000,
    );
    const pending = candidate(intent.reference, "100", {
      chainStatus: "CONFIRMED",
      poiStatus: "PENDING",
      balanceBucket: "MissingExternalPOI",
    });
    reconciliation.reconcile(pending, 1_500);
    expect(intents.requireView(intent.id)).toMatchObject({
      status: "OPEN",
      receivedAmountAtomic: "0",
      pendingAmountAtomic: "100",
    });

    reconciliation.reconcile(
      {
        ...pending,
        chainStatus: "FINALIZED",
        poiStatus: "SPENDABLE",
        balanceBucket: "Spendable",
      },
      1_600,
    );
    expect(intents.requireView(intent.id)).toMatchObject({
      status: "PAID",
      receivedAmountAtomic: "100",
      pendingAmountAtomic: "0",
    });
    database.close();
  });

  it("derives PAID_LATE from the settlement block timestamp", async () => {
    const { database, intents, reconciliation } = services();
    const intent = await intents.create(
      { externalReference: "INV-LATE", amountAtomic: "10", expiresAt: 2_000 },
      1_000,
    );
    reconciliation.reconcile(
      candidate(intent.reference, "10", { blockTimestamp: 2_001 }),
      2_100,
    );
    expect(intents.requireView(intent.id).status).toBe("PAID_LATE");
    database.close();
  });

  it("removes reorged value and emits a persisted reversal", async () => {
    const { database, intents, reconciliation } = services();
    const intent = await intents.create(
      { externalReference: "INV-REORG", amountAtomic: "10", expiresAt: 3_000 },
      1_000,
    );
    const settlement = candidate(intent.reference, "10");
    reconciliation.reconcile(settlement, 1_500);
    expect(intents.requireView(intent.id).status).toBe("PAID");
    reconciliation.reconcile({ ...settlement, chainStatus: "REVERTED" }, 1_600);
    expect(intents.requireView(intent.id)).toMatchObject({
      status: "OPEN",
      receivedAmountAtomic: "0",
    });
    expect(database.listEvents().at(-1)?.type).toBe("payment.reverted");
    database.close();
  });

  it("isolates a recognized reference paid with the wrong token", async () => {
    const { database, intents, reconciliation } = services();
    const intent = await intents.create(
      { externalReference: "INV-CONFLICT", amountAtomic: "10", expiresAt: 3_000 },
      1_000,
    );
    const stored = reconciliation.reconcile(
      candidate(intent.reference, "10", {
        tokenAddress: "0x00000000000000000000000000000000000000b2",
      }),
      1_500,
    );
    expect(stored.matchStatus).toBe("CONFLICT");
    expect(intents.requireView(intent.id).status).toBe("OPEN");
    expect(database.listEvents()).toHaveLength(0);
    database.close();
  });
});
