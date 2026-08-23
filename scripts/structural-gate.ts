import assert from "node:assert/strict";
import { join } from "node:path";

import {
  createViewOnlyRailgunWallet,
  fullWalletForID,
  loadWalletByID,
  viewOnlyWalletForID,
} from "@railgun-community/wallet";

import {
  STATE_ROOT,
  ensureHexSecretFile,
  readSecretFile,
  startEngine,
  stopEngine,
} from "./kill-test-support.js";

const root = join(STATE_ROOT, "structural");
const keyPath = process.env.PPOPS_VIEWING_KEY_FILE ?? join(STATE_ROOT, "fixture.viewing-key");
const shareableViewingKey = await readSecretFile(keyPath);
const encryptionKey = await ensureHexSecretFile(join(root, "db.key"));
let walletID: string;
let railgunAddress: string;

await startEngine({
  dbPath: join(root, "engine.db"),
  artifactsPath: join(STATE_ROOT, "artifacts"),
  skipMerkletreeScans: false,
  withTestPOINode: false,
});

try {
  const info = await createViewOnlyRailgunWallet(
    encryptionKey,
    shareableViewingKey,
    undefined,
  );
  walletID = info.id;
  railgunAddress = info.railgunAddress;

  const wallet = viewOnlyWalletForID(walletID);
  assert.throws(() => fullWalletForID(walletID), /View-Only wallet/);
  await assert.rejects(
    async () => wallet.sign({} as never, encryptionKey),
    /View-Only wallet cannot generate signatures/,
  );
} finally {
  await stopEngine();
}

// Restart against the same encrypted LevelDOWN database and load by wallet ID.
await startEngine({
  dbPath: join(root, "engine.db"),
  artifactsPath: join(STATE_ROOT, "artifacts"),
  skipMerkletreeScans: false,
  withTestPOINode: false,
});

try {
  const loaded = await loadWalletByID(encryptionKey, walletID, true);
  assert.equal(loaded.id, walletID);
  assert.equal(loaded.railgunAddress, railgunAddress);
  viewOnlyWalletForID(walletID);

  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      tests: {
        importedFromShareableViewingKey: "PASS",
        fullWalletAccessorRejected: "PASS",
        signatureGenerationRejected: "PASS",
        encryptedDatabaseRestart: "PASS",
      },
      walletID,
      viewingKeyPrinted: false,
      mnemonicAcceptedByReceiver: false,
    })}\n`,
  );
} finally {
  await stopEngine();
}
