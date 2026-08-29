import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import {
  compareRailwayCacheInspections,
  inspectRailwayCache,
} from "../src/pilot/railway-sync-doctor.js";

const execFileAsync = promisify(execFile);
const wait = (milliseconds: number): Promise<void> =>
  new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));

const railwayProcessRunning = async (): Promise<boolean | undefined> => {
  if (process.platform !== "darwin") return undefined;
  try {
    await execFileAsync("pgrep", ["-x", "Railway"]);
    return true;
  } catch (error) {
    const exitCode = (error as NodeJS.ErrnoException & { code?: number | string }).code;
    if (String(exitCode) === "1") return false;
    return undefined;
  }
};

const args = process.argv.slice(2);
let appDataPath = join(homedir(), "Library", "Application Support", "railway-reactjs");
let quietThresholdSeconds = 1_200;
let observeSeconds = 0;
for (let index = 0; index < args.length; index += 1) {
  const argument = args[index];
  if (argument === "--app-data") {
    const value = args[index + 1];
    if (!value) throw new Error("--app-data requires a path");
    appDataPath = resolve(value);
    index += 1;
    continue;
  }
  if (argument === "--quiet-seconds") {
    const value = Number(args[index + 1]);
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error("--quiet-seconds requires a positive integer");
    }
    quietThresholdSeconds = value;
    index += 1;
    continue;
  }
  if (argument === "--observe-seconds") {
    const value = Number(args[index + 1]);
    if (!Number.isInteger(value) || value < 1 || value > 300) {
      throw new Error("--observe-seconds requires an integer from 1 to 300");
    }
    observeSeconds = value;
    index += 1;
    continue;
  }
  throw new Error(`Unsupported option: ${argument ?? ""}`);
}

const indexedDbPath = join(appDataPath, "IndexedDB");
const initial = await inspectRailwayCache(indexedDbPath, {
  quietThresholdSeconds,
});
if (observeSeconds > 0) await wait(observeSeconds * 1_000);
const inspection =
  observeSeconds > 0
    ? await inspectRailwayCache(indexedDbPath, { quietThresholdSeconds })
    : initial;
const observation = compareRailwayCacheInspections(initial, inspection);
const processRunning = await railwayProcessRunning();
const diagnosis =
  processRunning === false
    ? "APP_NOT_RUNNING"
    : observeSeconds > 0 && observation.advanced
      ? "CACHE_ADVANCING"
      : observeSeconds > 0 && inspection.state === "QUIET" && processRunning === true
        ? "SUSPECTED_STALL"
        : inspection.state === "QUIET"
          ? "PROLONGED_QUIET"
        : observeSeconds > 0
          ? "RUNNING_NO_WRITE_OBSERVED"
          : "RECENT_WRITE_ONLY";
process.stdout.write(
  `${JSON.stringify({
    ok: inspection.state !== "MISSING" && inspection.state !== "EMPTY",
    ...inspection,
    processRunning,
    observationSeconds: observeSeconds,
    cacheAdvancedDuringObservation: observation.advanced,
    diagnosis,
    interpretation:
      processRunning === false
        ? "Railway is not running, so synchronization cannot progress."
        : observation.advanced
          ? "The cache changed during observation. Railway is making measurable progress even if its displayed percentage is stale."
          : inspection.state === "QUIET" && observeSeconds === 0
            ? "The cache has been quiet beyond the threshold. Run again with --observe-seconds before treating it as a suspected stall."
          : inspection.state === "ACTIVE"
            ? "The cache was written recently, but this sample did not prove continued progress. Use --observe-seconds to measure it."
        : inspection.state === "QUIET"
          ? "No recent cache writes were observed. If Railway says it is syncing, treat this as a suspected stall."
          : "No usable Railway IndexedDB cache was found.",
  })}\n`,
);
