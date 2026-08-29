import { readFile, readdir } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";

const root = resolve(import.meta.dirname, "..");
const merchantRoot = resolve(root, "src");
const payerRoot = resolve(root, "tools", "ppops-payer");

const sourceFiles = async (directory: string): Promise<string[]> => {
  const output: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = resolve(directory, entry.name);
    if (entry.isDirectory()) output.push(...(await sourceFiles(target)));
    if (entry.isFile() && entry.name.endsWith(".ts")) output.push(target);
  }
  return output;
};

const within = (candidate: string, boundary: string): boolean =>
  candidate === boundary || candidate.startsWith(`${boundary}${sep}`);

const relativeImports = (text: string): string[] => {
  const imports: string[] = [];
  const pattern = /(?:from\s+|import\s*\()\s*["']([^"']+)["']/g;
  for (const match of text.matchAll(pattern)) {
    const specifier = match[1];
    if (specifier?.startsWith(".")) imports.push(specifier);
  }
  return imports;
};

const failures: string[] = [];
for (const file of await sourceFiles(merchantRoot)) {
  const text = await readFile(file, "utf8");
  for (const specifier of relativeImports(text)) {
    const target = resolve(dirname(file), specifier);
    if (within(target, payerRoot)) {
      failures.push(`${relative(root, file)} imports payer code`);
    }
  }
}

const payerSourceRoot = resolve(payerRoot, "src");
for (const file of await sourceFiles(payerSourceRoot)) {
  const text = await readFile(file, "utf8");
  for (const specifier of relativeImports(text)) {
    const target = resolve(dirname(file), specifier);
    if (!within(target, payerRoot)) {
      failures.push(`${relative(root, file)} escapes the payer package`);
    }
  }
}

const merchantCli = await readFile(resolve(merchantRoot, "cli.ts"), "utf8");
if (/["'](?:mnemonic(?:-file)?|spending-key(?:-file)?|railgun-private-key(?:-file)?)["']/.test(merchantCli)) {
  failures.push("src/cli.ts accepts RAILGUN spending material");
}

const dockerfile = await readFile(resolve(root, "Dockerfile"), "utf8");
if (/^COPY\s+(?:\.\s|tools(?:\/|\s))/m.test(dockerfile)) {
  failures.push("Dockerfile copies payer tooling into the merchant image");
}

const buildConfig = await readFile(resolve(root, "tsconfig.build.json"), "utf8");
if (buildConfig.includes("tools/ppops-payer")) {
  failures.push("merchant build includes the payer package");
}

if (failures.length > 0) {
  process.stdout.write(`${JSON.stringify({ ok: false, failures })}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      result: "PASS",
      merchantRuntime: "view-only",
      payerRuntimeIncludedInMerchantBuild: false,
    })}\n`,
  );
}
