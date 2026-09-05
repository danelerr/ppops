import { readFile, writeFile } from "node:fs/promises";
import { openApiDocument } from "../src/api/openapi.js";
const path = new URL("../docs/openapi.json", import.meta.url);
const expected = JSON.stringify(openApiDocument, null, 2) + "\n";
if (process.argv.includes("--check")) {
  if ((await readFile(path, "utf8")) !== expected)
    throw new Error("OpenAPI reference is stale. Run npm run docs:generate.");
} else {
  await writeFile(path, expected);
}
