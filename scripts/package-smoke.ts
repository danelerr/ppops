import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
const run = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const temporary = await mkdtemp(resolve(tmpdir(), "ppops-package-smoke-"));
try {
  const packed = await run(
    "npm",
    ["pack", "--json", "--ignore-scripts", "--pack-destination", temporary],
    { cwd: root },
  );
  const [report] = JSON.parse(packed.stdout) as Array<{
    filename: string;
    files: Array<{ path: string }>;
  }>;
  if (!report) throw new Error("No package was built");
  const paths = report.files.map((file) => file.path);
  for (const required of [
    "dist/cli.js",
    "dist/client.js",
    "docs/QUICKSTART.md",
    "docs/openapi.json",
    "examples/merchant-app.mjs",
  ]) {
    if (!paths.includes(required))
      throw new Error(`Missing package entry: ${required}`);
  }
  if (
    paths.some(
      (path) =>
        /^(?:tools\/ppops-payer\/(?:src|dist|node_modules)|(?:secrets|data|instance)\/)/.test(
          path,
        ) || /\.(?:mnemonic|viewing-key|sqlite|key)$/.test(path),
    )
  )
    throw new Error("Package contains state or payer runtime");
  await run("tar", [
    "-xzf",
    resolve(temporary, report.filename),
    "-C",
    temporary,
  ]);
  const isolated = resolve(temporary, "package");
  await run(
    process.execPath,
    ["--import", "tsx", "scripts/check-docs.ts", "--root", isolated],
    { cwd: root },
  );
  if (process.argv.includes("--install")) {
    await run("npm", ["install", "--omit=dev", "--no-audit", "--no-fund"], {
      cwd: isolated,
      timeout: 240_000,
      maxBuffer: 8 * 1024 * 1024,
    });
  } else {
    // Quick local mode isolates shipped files; --install also verifies dependencies.
    await symlink(
      resolve(root, "node_modules"),
      resolve(isolated, "node_modules"),
      "dir",
    );
  }
  const pkg = JSON.parse(
    await readFile(resolve(isolated, "package.json"), "utf8"),
  ) as { version: string };
  const version = await run(process.execPath, ["dist/cli.js", "--version"], {
    cwd: isolated,
  });
  if (version.stdout.trim() !== pkg.version)
    throw new Error("Packaged CLI version mismatch");
  await run(process.execPath, ["dist/cli.js", "init", "--help"], {
    cwd: isolated,
  });
  await run(process.execPath, ["examples/merchant-app.mjs", "--help"], {
    cwd: isolated,
  });
  await run(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import { createDemo } from './dist/demo.js';
    import { usdcAtomic } from 'ppops/client';
    if (usdcAtomic('1.25') !== '1250000') throw Error('Public client export failed');
    const demo = await createDemo();
    try {
      const create = () => demo.app.request('/shop/orders/package-order-0001', { method: 'POST', headers: {'content-type':'application/json'}, body:'{}' });
      const first = await create(); if (first.status !== 201) throw Error('Order creation failed');
      const order = await first.json();
      if ((await (await create()).json()).intent_id !== order.intent_id) throw Error('Retry changed intent');
      const pay = await demo.app.request('/demo/' + order.intent_id + '/confirm', { method:'POST', headers:{'content-type':'application/json'}, body:'{}' });
      if (!pay.ok) throw Error('Simulation failed');
      const result = await (await demo.app.request('/shop/orders/package-order-0001')).json();
      if (result.status !== 'fulfilled' || result.fulfillment_count !== 1) throw Error('Fulfillment failed');
    } finally { await demo.close(); }
  `,
    ],
    { cwd: isolated, timeout: 30_000 },
  );
  console.log(
    `Packaged version ${pkg.version}: CLI, docs, example, idempotency and verified fulfillment passed (${process.argv.includes("--install") ? "fresh production dependency install" : "existing dependencies"}).`,
  );
} finally {
  // Only this script's mkdtemp directory is removed.
  await rm(temporary, { recursive: true, force: true });
}
