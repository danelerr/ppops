import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const sourceFiles = [
  "src/cli.ts",
  "src/events.ts",
  "src/execution-guards.ts",
  "src/railgun/engine.ts",
  "src/railgun/self-signed-transfer.ts",
  "src/security/secrets.ts",
];

const sources = await Promise.all(
  sourceFiles.map(async (path) => ({ path, text: await readFile(resolve(root, path), "utf8") })),
);
const failures: string[] = [];
for (const { path, text } of sources) {
  if (/console\.(?:log|error|warn)/.test(text)) failures.push(`${path}: console output`);
  if (/error\.message/.test(text)) failures.push(`${path}: raw error message`);
  const eventCalls = text.match(/writeEvent\([\s\S]{0,500}?\);/g) ?? [];
  for (const call of eventCalls) {
    if (/mnemonic|evmPrivateKey|dbEncryptionKey/.test(call)) {
      failures.push(`${path}: spending material near telemetry call`);
    }
  }
}
const cli = sources.find(({ path }) => path === "src/cli.ts")?.text ?? "";
if (/--(?:mnemonic|private-key)(?=[=\s"']|$)/.test(cli)) {
  failures.push("src/cli.ts: secret accepted directly as a CLI argument");
}
const gitignore = await readFile(resolve(root, ".gitignore"), "utf8");
for (const required of ["secrets/", "data/", "payer.config.json", "*.mnemonic", "*.key"]) {
  if (!gitignore.includes(required)) failures.push(`.gitignore: missing ${required}`);
}
if (failures.length > 0) {
  process.stdout.write(`${JSON.stringify({ ok: false, failures })}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`${JSON.stringify({ ok: true, result: "PASS" })}\n`);
}
