// Run from the package working directory through Node's stdin module mode.
// All keys, providers and payment records below are synthetic; no RPC is made.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "./dist/cli.js";
import { diagnose } from "./dist/operations/doctor.js";
import { createDemo } from "./dist/demo.js";

const directory = await mkdtemp(join(tmpdir(), "ppops-container-smoke-"));
try {
  const viewing = join(directory, "merchant.viewing-key");
  await writeFile(viewing, "fixture-view-only-" + "a".repeat(80), {
    mode: 0o600,
  });
  const configPath = join(directory, "instance", "ppops.config.json");
  await main([
    "init",
    "--container",
    "--profile",
    "arbitrum-usdc",
    "--config",
    configPath,
    "--viewing-key-file",
    viewing,
    "--rpc-url",
    "https://provider-a.example",
    "--rpc-url",
    "https://provider-b.example",
    "--poi-node",
    "https://poi.example",
  ]);
  const config = JSON.parse(await readFile(configPath, "utf8"));
  assert.equal(config.server.host, "0.0.0.0");
  assert.equal(config.network.chainId, 42161);
  assert.equal(config.secrets.viewingKeyFile, "../merchant.viewing-key");
  const noNetwork = async () => {
    throw Error("Offline diagnosis must not use the network");
  };
  assert.equal(
    (
      await diagnose({
        configPath,
        offline: true,
        fetch: noNetwork,
        preflight: noNetwork,
      })
    ).ok,
    true,
  );

  const demo = await createDemo();
  try {
    const order = await (
      await demo.app.request("/shop/orders/container-order-0001", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      })
    ).json();
    assert.ok(order.intent_id);
    assert.equal(
      (
        await demo.app.request(`/demo/${order.intent_id}/confirm`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        })
      ).status,
      200,
    );
    const result = await (
      await demo.app.request("/shop/orders/container-order-0001")
    ).json();
    assert.equal(result.status, "fulfilled");
    assert.equal(result.fulfillment_count, 1);
  } finally {
    await demo.close();
  }
  console.log(
    "Container onboarding: initialization, portable paths, offline doctor and verified demo passed.",
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
