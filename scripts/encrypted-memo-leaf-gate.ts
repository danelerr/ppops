import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";

import {
  AbstractWallet,
  ByteLength,
  ByteUtils,
  ChainType,
  CommitmentType,
  Database,
  OutputType,
  POI,
  POIListType,
  Prover,
  RailgunWallet,
  TransactNote,
  TXIDVersion,
  ViewOnlyWallet,
  WalletBalanceBucket,
  getTokenDataERC20,
  type ArtifactGetter,
  type CommitmentCiphertextV2,
  type TransactCommitmentV2,
} from "@railgun-community/engine";
import leveldown, { type LevelDown } from "leveldown";

// These primitives are public in the engine source but omitted from its top-
// level export barrel. The pinned-path imports are intentional gate coverage:
// PPOps already needs the same direct TXO surface to obtain tree/position IDs.
import { UTXOMerkletree } from "../node_modules/@railgun-community/engine/dist/merkletree/utxo-merkletree.js";
import {
  getNoteBlindingKeys,
  getSharedSymmetricKey,
} from "../node_modules/@railgun-community/engine/dist/utils/keys-utils.js";

import { STATE_ROOT } from "./kill-test-support.js";

const PUBLIC_UPSTREAM_TEST_MNEMONIC =
  "test test test test test test test test test test test junk";
const require = createRequire(import.meta.url);
const WalletInfo = (
  require("../node_modules/@railgun-community/engine/dist/wallet/wallet-info.js") as {
    default: { setWalletSource: (source: string) => void };
  }
).default;
const VIEWING_KEY_PATH =
  process.env.PPOPS_VIEWING_KEY_FILE ?? join(STATE_ROOT, "fixture.viewing-key");
const TOKEN_ADDRESS = "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238";
const AMOUNT_ATOMIC = 123_456n;
const TREE = 7;
const POSITION = 23;
const BLOCK_NUMBER = 9_999_999;
const TRANSACTION_HASH = `0x${"ab".repeat(32)}`;
const RAILGUN_TXID = `0x${"cd".repeat(32)}`;
const chain = { type: ChainType.EVM, id: 11155111 };

const reference = `0x${randomBytes(32).toString("hex")}`;
const memoText = `ppops:v1:${reference}`;
const encryptionKey = randomBytes(32).toString("hex");

const noArtifacts: ArtifactGetter = {
  assertArtifactExists: () => {
    throw new Error("Proof artifacts are intentionally unavailable in the leaf gate.");
  },
  getArtifacts: async () => {
    throw new Error("Proof generation is outside the encrypted-leaf gate.");
  },
  getArtifactsPOI: async () => {
    throw new Error("PPOI proof generation is outside the encrypted-leaf gate.");
  },
};

const prover = () => new Prover(noArtifacts);
const createLevelDown = leveldown as unknown as (location: string) => LevelDown;
const dbAt = (path: string) => new Database(createLevelDown(path) as never);

// Only bucket derivation is used here. The live Sepolia gate exercises the
// actual PPOI node interface and reports the real raw buckets/statuses.
POI.init(
  [
    {
      key: "ppops-leaf-gate",
      type: POIListType.Active,
      name: "PPOps leaf gate",
      description: "Local deterministic PPOI bucket fixture",
    },
  ],
  {} as never,
);

await mkdir(STATE_ROOT, { recursive: true });
const runRoot = await mkdtemp(join(STATE_ROOT, "encrypted-leaf-"));
const senderDBPath = join(runRoot, "sender.db");
const receiverDBPath = join(runRoot, "receiver.db");
const reportPath = join(runRoot, "report.json");

const senderDB = dbAt(senderDBPath);
let receiverDB = dbAt(receiverDBPath);

try {
  // The full wallet exists only in the isolated sender database. Account 1 is
  // used so it differs from the public fixture's account-0 receiver.
  const sender = await RailgunWallet.fromMnemonic(
    senderDB,
    encryptionKey,
    PUBLIC_UPSTREAM_TEST_MNEMONIC,
    1,
    undefined,
    prover(),
  );

  const shareableViewingKey = (await readFile(VIEWING_KEY_PATH, "utf8")).trim();
  const receiver = (await ViewOnlyWallet.fromShareableViewingKey(
    receiverDB,
    encryptionKey,
    shareableViewingKey,
    undefined,
    prover(),
  )) as ViewOnlyWallet;

  const encryptedReceiverData = await AbstractWallet.getEncryptedData(
    receiverDB,
    encryptionKey,
    receiver.id,
  );
  assert("shareableViewingKey" in encryptedReceiverData);
  assert(!("mnemonic" in encryptedReceiverData));

  const tree = await UTXOMerkletree.create(
    receiverDB,
    chain,
    TXIDVersion.V2_PoseidonMerkle,
    async () => true,
  );
  await receiver.loadUTXOMerkletree(TXIDVersion.V2_PoseidonMerkle, tree);

  WalletInfo.setWalletSource("ppopsgate");
  const tokenData = getTokenDataERC20(TOKEN_ADDRESS);
  const note = TransactNote.createTransfer(
    receiver.addressKeys,
    sender.addressKeys,
    AMOUNT_ATOMIC,
    tokenData,
    true,
    OutputType.Transfer,
    memoText,
  );
  assert(note.senderRandom, "RAILGUN did not create senderRandom.");

  const senderViewingKeys = sender.getViewingKeyPair();
  const blindingKeys = getNoteBlindingKeys(
    senderViewingKeys.pubkey,
    receiver.addressKeys.viewingPublicKey,
    note.random,
    note.senderRandom,
  );
  const sharedKey = await getSharedSymmetricKey(
    senderViewingKeys.privateKey,
    blindingKeys.blindedReceiverViewingKey,
  );
  assert(sharedKey, "RAILGUN did not derive the sender/receiver shared key.");

  const { noteCiphertext, noteMemo, annotationData } = note.encryptV2(
    TXIDVersion.V2_PoseidonMerkle,
    sharedKey,
    sender.addressKeys.masterPublicKey,
    note.senderRandom,
    senderViewingKeys.privateKey,
  );
  const ciphertext: CommitmentCiphertextV2 = {
    ciphertext: noteCiphertext,
    blindedSenderViewingKey: ByteUtils.hexlify(
      blindingKeys.blindedSenderViewingKey,
    ),
    blindedReceiverViewingKey: ByteUtils.hexlify(
      blindingKeys.blindedReceiverViewingKey,
    ),
    annotationData,
    memo: noteMemo,
  };
  const leaf: TransactCommitmentV2 = {
    commitmentType: CommitmentType.TransactCommitmentV2,
    hash: ByteUtils.nToHex(note.hash, ByteLength.UINT_256),
    txid: TRANSACTION_HASH,
    timestamp: 1_787_467_200,
    blockNumber: BLOCK_NUMBER,
    utxoTree: TREE,
    utxoIndex: POSITION,
    railgunTxid: RAILGUN_TXID,
    ciphertext,
  };
  const publicLeafArtifact = JSON.stringify(leaf).toLowerCase();
  assert(!publicLeafArtifact.includes(reference.toLowerCase()));
  assert(!publicLeafArtifact.includes(memoText.toLowerCase()));

  await receiver.scanLeaves(
    TXIDVersion.V2_PoseidonMerkle,
    [leaf],
    TREE,
    chain,
    POSITION,
    undefined,
  );
  const firstTXOs = await receiver.TXOs(TXIDVersion.V2_PoseidonMerkle, chain);
  assert.equal(firstTXOs.length, 1);
  const first = firstTXOs[0];
  assert(first);
  assert.equal(first.note.memoText, memoText);
  assert.equal(first.note.value, AMOUNT_ATOMIC);
  assert.equal(first.note.tokenData.tokenAddress.toLowerCase(), TOKEN_ADDRESS);
  assert.equal(first.txid, TRANSACTION_HASH);
  assert.equal(first.transactCreationRailgunTxid, RAILGUN_TXID);
  assert.equal(first.tree, TREE);
  assert.equal(first.position, POSITION);
  assert.equal(
    POI.getBalanceBucket(first),
    WalletBalanceBucket.MissingExternalPOI,
  );
  await assert.rejects(
    async () => receiver.sign({} as never, encryptionKey),
    /View-Only wallet cannot generate signatures/,
  );

  const walletID = receiver.id;
  const railgunAddress = receiver.getAddress(chain);
  const uniqueSettlementId =
    `${chain.id}:${TXIDVersion.V2_PoseidonMerkle}:${first.txid}:` +
    `${first.tree}:${first.position}`;

  // Re-open only the receiver database and prove that the same decrypted note
  // and stable settlement identifier survive a process-equivalent restart.
  await receiverDB.close();
  receiverDB = dbAt(receiverDBPath);
  const restarted = (await ViewOnlyWallet.loadExisting(
    receiverDB,
    encryptionKey,
    walletID,
    prover(),
  )) as ViewOnlyWallet;
  const restartedTree = await UTXOMerkletree.create(
    receiverDB,
    chain,
    TXIDVersion.V2_PoseidonMerkle,
    async () => true,
  );
  await restarted.loadUTXOMerkletree(
    TXIDVersion.V2_PoseidonMerkle,
    restartedTree,
  );
  const restartedTXOs = await restarted.TXOs(
    TXIDVersion.V2_PoseidonMerkle,
    chain,
  );
  assert.equal(restartedTXOs.length, 1);
  const afterRestart = restartedTXOs[0];
  assert(afterRestart);
  assert.equal(afterRestart.note.memoText, memoText);
  assert.equal(afterRestart.note.value, AMOUNT_ATOMIC);
  assert.equal(restarted.getAddress(chain), railgunAddress);
  assert.equal(
    `${chain.id}:${TXIDVersion.V2_PoseidonMerkle}:${afterRestart.txid}:` +
      `${afterRestart.tree}:${afterRestart.position}`,
    uniqueSettlementId,
  );

  const report = {
    ok: true,
    scope: "encrypted V2 commitment leaf; no contract/proof submission",
    receiverWalletType: "view-only",
    receiverStoredMnemonic: false,
    signatureGenerationRejected: true,
    memoFormatRecovered: /^ppops:v1:0x[0-9a-f]{64}$/.test(
      afterRestart.note.memoText ?? "",
    ),
    referenceDigest: createHash("sha256").update(reference).digest("hex"),
    tokenAddress: afterRestart.note.tokenData.tokenAddress.toLowerCase(),
    amountAtomic: afterRestart.note.value.toString(),
    transactionHash: afterRestart.txid,
    railgunTxid: afterRestart.transactCreationRailgunTxid,
    tree: afterRestart.tree,
    position: afterRestart.position,
    uniqueSettlementId,
    balanceBucket: POI.getBalanceBucket(afterRestart),
    restartRecoveredSameSettlement: true,
    opaqueReferenceAbsentFromPublicLeaf: true,
    plaintextMemoAbsentFromPublicLeaf: true,
    rawMemoPrinted: false,
  };
  await writeFile(reportPath, JSON.stringify(report, null, 2), { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ ...report, reportPath })}\n`);
} finally {
  if (!receiverDB.isClosed()) await receiverDB.close();
  if (!senderDB.isClosed()) await senderDB.close();
}
