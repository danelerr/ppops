import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  PayerRuntimeLock,
  payerRuntimeLockPath,
} from "../src/security/runtime-lock.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true })));
});

describe("payer runtime exclusivity", () => {
  it("prevents concurrent access to the same wallet state", async () => {
    const root = await mkdtemp(join(tmpdir(), "ppops-payer-lock-"));
    roots.push(root);
    const path = payerRuntimeLockPath(join(root, "wallet-state.json"));
    const first = await PayerRuntimeLock.acquire(path);
    try {
      await expect(PayerRuntimeLock.acquire(path)).rejects.toThrow(/process is active/);
    } finally {
      await first.release();
    }

    const next = await PayerRuntimeLock.acquire(path);
    await next.release();
  });
});
