import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";

type LockContents = {
  schemaVersion: 1;
  pid: number;
  token: string;
  createdAt: number;
};

const processIsAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

const readLock = async (path: string): Promise<LockContents | undefined> => {
  try {
    return JSON.parse(await readFile(path, "utf8")) as LockContents;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
};

export class RuntimeLock {
  private released = false;

  private constructor(
    readonly path: string,
    private readonly token: string,
  ) {}

  static async acquire(path: string): Promise<RuntimeLock> {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const token = randomUUID();
    const contents: LockContents = {
      schemaVersion: 1,
      pid: process.pid,
      token,
      createdAt: Math.floor(Date.now() / 1_000),
    };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const handle = await open(path, "wx", 0o600);
        try {
          await handle.writeFile(`${JSON.stringify(contents)}\n`, "utf8");
          await handle.sync();
        } finally {
          await handle.close();
        }
        return new RuntimeLock(path, token);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const existing = await readLock(path);
        if (existing && Number.isSafeInteger(existing.pid) && processIsAlive(existing.pid)) {
          throw new Error(`Another PPOps process is active with PID ${existing.pid}`);
        }
        await rename(path, `${path}.stale-${Date.now()}`);
      }
    }
    throw new Error("Unable to acquire the PPOps runtime lock");
  }

  static async assertStopped(path: string): Promise<void> {
    const existing = await readLock(path);
    if (!existing) return;
    if (Number.isSafeInteger(existing.pid) && processIsAlive(existing.pid)) {
      throw new Error(`PPOps must be stopped first (active PID ${existing.pid})`);
    }
  }

  async release(): Promise<void> {
    if (this.released) return;
    const contents = await readLock(this.path);
    if (contents?.token === this.token) await unlink(this.path);
    this.released = true;
  }
}

export const runtimeLockPath = (sqlitePath: string): string =>
  `${sqlitePath}.runtime-lock`;
