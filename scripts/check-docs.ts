import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const rootIndex = process.argv.indexOf("--root");
const root =
  rootIndex >= 0
    ? resolve(process.argv[rootIndex + 1] ?? ".")
    : resolve(import.meta.dirname, "..");
const markdown: string[] = [];
async function walk(directory: string) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    if (
      [
        "node_modules",
        ".git",
        "dist",
        "coverage",
        "images",
        "instance",
        "secrets",
        "data",
      ].includes(item.name)
    )
      continue;
    const path = resolve(directory, item.name);
    if (item.isDirectory()) await walk(path);
    else if (item.name.endsWith(".md")) markdown.push(path);
  }
}
await walk(root);
const failures: string[] = [];
for (const path of markdown) {
  const text = await readFile(path, "utf8");
  for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1]?.split("#")[0];
    if (!target || /^(https?:|mailto:|app:|plugin:)/.test(target)) continue;
    try {
      await stat(resolve(dirname(path), target));
    } catch {
      failures.push(`${path.slice(root.length + 1)} -> ${target}`);
    }
  }
}
if (failures.length)
  throw new Error(`Broken documentation links:\n${failures.join("\n")}`);
console.log(`Checked local links in ${markdown.length} Markdown files.`);
