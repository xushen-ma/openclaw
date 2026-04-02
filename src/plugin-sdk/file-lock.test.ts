import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const defaultLockOptions = {
  retries: {
    retries: 2,
    factor: 1.2,
    minTimeout: 5,
    maxTimeout: 20,
    randomize: false,
  },
  stale: 30_000,
};

let acquireFileLock: typeof import("./file-lock.js").acquireFileLock;
let resetFileLockStateForTest: typeof import("./file-lock.js").resetFileLockStateForTest;
let drainFileLockStateForTest: typeof import("./file-lock.js").drainFileLockStateForTest;

async function withTempPath(
  run: (params: { filePath: string; lockPath: string }) => Promise<void>,
): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-file-lock-"));
  try {
    const filePath = path.join(root, "sessions.json");
    await run({ filePath, lockPath: `${filePath}.lock` });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

describe("file-lock", () => {
  beforeEach(async () => {
    ({ acquireFileLock, resetFileLockStateForTest, drainFileLockStateForTest } =
      await import("./file-lock.js"));
    resetFileLockStateForTest();
  });

  afterEach(async () => {
    await drainFileLockStateForTest();
    vi.restoreAllMocks();
  });

  it("acquires and releases a file lock on the normal path", async () => {
    await withTempPath(async ({ filePath, lockPath }) => {
      const lock = await acquireFileLock(filePath, defaultLockOptions);
      await expect(fs.access(lockPath)).resolves.toBeUndefined();
      await lock.release();
      await expect(fs.access(lockPath)).rejects.toThrow();
    });
  });

  it("reclaims stale lock files during contention", async () => {
    await withTempPath(async ({ filePath, lockPath }) => {
      const staleLock = {
        pid: 999_999,
        createdAt: new Date(Date.now() - 90_000).toISOString(),
      };
      await fs.writeFile(lockPath, JSON.stringify(staleLock), "utf8");

      const lock = await acquireFileLock(filePath, defaultLockOptions);
      await expect(fs.access(lockPath)).resolves.toBeUndefined();
      await lock.release();
      await expect(fs.access(lockPath)).rejects.toThrow();
    });
  });

  it("reclaims stale partially written lock files", async () => {
    await withTempPath(async ({ filePath, lockPath }) => {
      const oldMtime = new Date(Date.now() - 3_000);
      await fs.writeFile(lockPath, "{}", "utf8");
      await fs.utimes(lockPath, oldMtime, oldMtime);

      const lock = await acquireFileLock(filePath, defaultLockOptions);
      await expect(fs.access(lockPath)).resolves.toBeUndefined();
      await lock.release();
      await expect(fs.access(lockPath)).rejects.toThrow();
    });
  });

  it("cleans up a partial lock when lock write fails", async () => {
    await withTempPath(async ({ filePath, lockPath }) => {
      const writeFileSpy = vi.fn(async () => {
        throw new Error("transient write failure");
      });
      const closeSpy = vi.fn(async () => undefined);
      const badHandle = {
        writeFile: writeFileSpy,
        close: closeSpy,
      } as unknown as fs.FileHandle;

      const openSpy = vi.spyOn(fs, "open").mockResolvedValueOnce(badHandle);
      const lockError = acquireFileLock(filePath, defaultLockOptions);

      await expect(lockError).rejects.toThrow("transient write failure");
      expect(closeSpy).toHaveBeenCalledTimes(1);
      await expect(fs.access(lockPath)).rejects.toThrow();
      openSpy.mockRestore();

      const lock = await acquireFileLock(filePath, defaultLockOptions);
      const [actualLockPath, expectedLockPath] = await Promise.all([
        fs.realpath(lock.lockPath),
        fs.realpath(lockPath),
      ]);
      expect(actualLockPath).toBe(expectedLockPath);
      await lock.release();
      await expect(fs.access(lockPath)).rejects.toThrow();
    });
  });
});
