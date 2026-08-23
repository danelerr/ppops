import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import {
  createRailgunWallet,
  getWalletShareableViewingKey,
} from "@railgun-community/wallet";

import {
  STATE_ROOT,
  ensureHexSecretFile,
  startEngine,
  stopEngine,
} from "./kill-test-support.js";

// Public test fixture used by the upstream RAILGUN Wallet SDK tests.
// This process exists only to export its shareable viewing key. The receiver
// scanner is a separate program and contains no mnemonic/spending-key input.
const PUBLIC_UPSTREAM_TEST_MNEMONIC =
  "test test test test test test test test test test test junk";

const outputPath = resolve(
  process.env.PPOPS_VIEWING_KEY_FILE ?? join(STATE_ROOT, "fixture.viewing-key"),
);
const fixtureRoot = join(STATE_ROOT, "fixture-exporter");
const encryptionKey = await ensureHexSecretFile(join(fixtureRoot, "db.key"));

try {
  await startEngine({
    dbPath: join(fixtureRoot, "engine.db"),
    artifactsPath: join(STATE_ROOT, "artifacts"),
    skipMerkletreeScans: false,
    withTestPOINode: false,
  });

  const wallet = await createRailgunWallet(
    encryptionKey,
    PUBLIC_UPSTREAM_TEST_MNEMONIC,
    undefined,
  );
  const shareableViewingKey = await getWalletShareableViewingKey(wallet.id);
  if (!shareableViewingKey) {
    throw new Error("RAILGUN did not return a shareable viewing key.");
  }

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, shareableViewingKey, { mode: 0o600 });
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      fixture: "upstream-public-test-wallet",
      viewingKeyWritten: outputPath,
      viewingKeyPrinted: false,
    })}\n`,
  );
} finally {
  await stopEngine();
}
