// Build info tests cover canonical package provenance generation.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveUiBuildEnvironment } from "../../scripts/ui.mts";
import {
  normalizeBuildCommit,
  normalizeBuildTimestamp,
  resolveBuildInfo,
  writeBuildInfo,
} from "../../scripts/write-build-info.ts";
import { useAutoCleanupTempDirTracker } from "../helpers/temp-dir.js";

describe("write-build-info", () => {
  const tempDirs = useAutoCleanupTempDirTracker(afterEach);

  function runGit(rootDir: string, args: string[]): string {
    return execFileSync("git", args, {
      cwd: rootDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  }

  function commitAll(rootDir: string, message: string): void {
    runGit(rootDir, ["add", "."]);
    runGit(rootDir, [
      "-c",
      "user.name=OpenClaw Test",
      "-c",
      "user.email=test@example.org",
      "commit",
      "-m",
      message,
    ]);
  }

  function createPackage(version = "2026.7.10"): string {
    const rootDir = tempDirs.make("openclaw-build-info-");
    fs.writeFileSync(path.join(rootDir, "package.json"), `${JSON.stringify({ version })}\n`);
    return rootDir;
  }

  function createGitPackage(version = "2026.9.2"): string {
    const rootDir = createPackage(version);
    runGit(rootDir, ["init"]);
    commitAll(rootDir, "fixture");
    return rootDir;
  }

  it("records an exact governed fork tag at HEAD without changing the display version", () => {
    const rootDir = createGitPackage();
    runGit(rootDir, ["tag", "v2026.9.2-x.2"]);
    const commit = runGit(rootDir, ["rev-parse", "HEAD"]);

    const outputPath = writeBuildInfo({
      rootDir,
      env: {
        GIT_COMMIT: commit,
        OPENCLAW_BUILD_VERSION: "v2026.9.2",
        OPENCLAW_VERSION: "v2026.9.2",
      },
      now: () => new Date("2026-09-06T01:02:03.000Z"),
    });

    expect(JSON.parse(fs.readFileSync(outputPath, "utf8"))).toMatchObject({
      version: "2026.9.2",
      releaseTag: "v2026.9.2-x.2",
      buildId: `v2026.9.2-x.2-${commit.slice(0, 12)}-2026-09-06T01-02-03.000Z`,
    });
  });

  it("selects the highest approved governed tag at HEAD", () => {
    const rootDir = createGitPackage();
    for (const tag of [
      "v2026.9.2-x.1",
      "v2026.9.2-x.2",
      "v2026.9.2-x.10",
      "v2026.9.2-x.0",
      "v2026.9.2-beta.1",
    ]) {
      runGit(rootDir, ["tag", tag]);
    }

    expect(
      resolveBuildInfo({
        rootDir,
        env: {},
        now: () => new Date("2026-09-06T01:02:03.000Z"),
      }).releaseTag,
    ).toBe("v2026.9.2-x.10");
  });

  it("ignores stable and unapproved tags at HEAD", () => {
    const rootDir = createGitPackage();
    for (const tag of ["v2026.9.2", "v2026.9.2-x.0", "v2026.9.2-x.one"]) {
      runGit(rootDir, ["tag", tag]);
    }

    expect(
      resolveBuildInfo({
        rootDir,
        env: {
          OPENCLAW_BUILD_VERSION: "v2026.9.2",
          OPENCLAW_VERSION: "v2026.9.2",
        },
        now: () => new Date("2026-09-06T01:02:03.000Z"),
      }),
    ).toMatchObject({
      version: "2026.9.2",
      releaseTag: null,
    });
  });

  it("does not attribute an ancestor's governed tag to HEAD", () => {
    const rootDir = createGitPackage();
    runGit(rootDir, ["tag", "v2026.9.2-x.9"]);
    fs.writeFileSync(path.join(rootDir, "README.md"), "next revision\n");
    commitAll(rootDir, "next");
    const commit = runGit(rootDir, ["rev-parse", "HEAD"]);

    expect(
      resolveBuildInfo({
        rootDir,
        env: {},
        now: () => new Date("2026-09-06T01:02:03.000Z"),
      }),
    ).toMatchObject({
      version: "2026.9.2",
      releaseTag: null,
      buildId: `2026.9.2-${commit.slice(0, 12)}-2026-09-06T01-02-03.000Z`,
    });
  });

  it("does not attribute the checked-out tag to a different explicit build commit", () => {
    const rootDir = createGitPackage();
    runGit(rootDir, ["tag", "v2026.9.2-x.9"]);
    const buildCommit = "f".repeat(40);

    expect(
      resolveBuildInfo({
        rootDir,
        env: { GIT_COMMIT: buildCommit },
        now: () => new Date("2026-09-06T01:02:03.000Z"),
      }),
    ).toMatchObject({
      version: "2026.9.2",
      releaseTag: null,
      commit: buildCommit,
      buildId: `2026.9.2-${buildCommit.slice(0, 12)}-2026-09-06T01-02-03.000Z`,
    });
  });

  it("lets a later standalone Control UI build reuse the governed runtime build id", () => {
    const rootDir = createGitPackage();
    runGit(rootDir, ["tag", "v2026.9.2-x.3"]);
    const buildInfo = resolveBuildInfo({
      rootDir,
      env: {},
      now: () => new Date("2026-09-06T01:02:03.000Z"),
    });

    const uiEnv = resolveUiBuildEnvironment({
      env: {},
      now: () => new Date("2026-09-06T01:03:00.000Z"),
      readBuildInfo: () => buildInfo,
      readGitCommit: () => buildInfo.commit,
      readPackageVersion: () => buildInfo.version,
    });

    expect(uiEnv).toMatchObject({
      GIT_COMMIT: buildInfo.commit,
      OPENCLAW_BUILD_TIMESTAMP: buildInfo.builtAt,
      OPENCLAW_CONTROL_UI_BUILD_ID: buildInfo.buildId,
    });
  });

  it("normalizes explicit release provenance and writes the shared manifest", () => {
    const rootDir = createPackage();
    const execFileSyncMock = vi.fn(() => {
      throw new Error("Git metadata is unavailable in this source package");
    });

    const outputPath = writeBuildInfo({
      rootDir,
      env: {
        GIT_COMMIT: "ABCDEF0123456789ABCDEF0123456789ABCDEF01",
        OPENCLAW_BUILD_TIMESTAMP: "2026-07-10T12:34:56Z",
      },
      execFileSync: execFileSyncMock,
    });

    expect(execFileSyncMock).toHaveBeenCalledOnce();
    expect(execFileSyncMock).toHaveBeenCalledWith("git", ["rev-parse", "HEAD"], {
      cwd: rootDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    expect(path.relative(rootDir, outputPath)).toBe("dist/build-info.json");
    expect(JSON.parse(fs.readFileSync(outputPath, "utf8"))).toEqual({
      version: "2026.7.10",
      releaseTag: null,
      commit: "abcdef0123456789abcdef0123456789abcdef01",
      builtAt: "2026-07-10T12:34:56.000Z",
      buildId: "2026.7.10-abcdef012345-2026-07-10T12-34-56.000Z",
    });
  });

  it("falls back to build-time Git and one current UTC timestamp for local builds", () => {
    const rootDir = createPackage("2026.7.10-beta.1");
    const execFileSyncMock = vi.fn(() => "1234567890ABCDEF1234567890ABCDEF12345678\n");

    expect(
      resolveBuildInfo({
        rootDir,
        env: {},
        execFileSync: execFileSyncMock,
        now: () => new Date("2026-07-10T01:02:03.456Z"),
      }),
    ).toEqual({
      version: "2026.7.10-beta.1",
      releaseTag: null,
      commit: "1234567890abcdef1234567890abcdef12345678",
      builtAt: "2026-07-10T01:02:03.456Z",
      buildId: "2026.7.10-beta.1-1234567890ab-2026-07-10T01-02-03.456Z",
    });
    expect(execFileSyncMock).toHaveBeenCalledWith("git", ["rev-parse", "HEAD"], {
      cwd: rootDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  });

  it("uses null when Git metadata is unavailable", () => {
    const rootDir = createPackage();

    expect(
      resolveBuildInfo({
        rootDir,
        env: {},
        execFileSync: () => {
          throw new Error("git unavailable");
        },
        now: () => new Date("2026-07-10T01:02:03.000Z"),
      }).commit,
    ).toBeNull();
  });

  it("shares explicit release artifact identity with the Control UI", () => {
    const rootDir = createPackage();
    expect(
      resolveBuildInfo({
        rootDir,
        env: {
          GIT_COMMIT: "a".repeat(40),
          OPENCLAW_BUILD_TIMESTAMP: "2026-07-10T01:02:03.000Z",
          OPENCLAW_CONTROL_UI_RELEASE_BUILD: "1",
        },
      }).buildId,
    ).toBe("2026.7.10-release-aaaaaaaaaaaa-2026-07-10T01-02-03.000Z");
  });

  it("preserves GIT_COMMIT then GIT_SHA explicit input precedence", () => {
    const rootDir = createPackage();
    const fallbackSha = "1234567890abcdef1234567890abcdef12345678";

    expect(
      resolveBuildInfo({
        rootDir,
        env: { GIT_SHA: fallbackSha },
        now: () => new Date("2026-07-10T01:02:03.000Z"),
      }).commit,
    ).toBe(fallbackSha);
    expect(() =>
      resolveBuildInfo({
        rootDir,
        env: { GIT_COMMIT: "bad", GIT_SHA: fallbackSha },
      }),
    ).toThrow("GIT_COMMIT must be a full 40-character Git commit SHA.");
  });

  it("uses checked-out Git instead of unverified GitHub workflow context", () => {
    const rootDir = createPackage();
    const checkedOutCommit = "b".repeat(40);
    const execFileSyncMock = vi.fn(() => checkedOutCommit);

    expect(
      resolveBuildInfo({
        rootDir,
        env: { GITHUB_SHA: "a".repeat(40) },
        execFileSync: execFileSyncMock,
        now: () => new Date("2026-07-10T01:02:03.000Z"),
      }).commit,
    ).toBe(checkedOutCommit);
    expect(execFileSyncMock).toHaveBeenNthCalledWith(1, "git", ["rev-parse", "HEAD"], {
      cwd: rootDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    expect(execFileSyncMock).toHaveBeenNthCalledWith(
      2,
      "git",
      ["tag", "--points-at", "HEAD", "--list", "--sort=-version:refname"],
      {
        cwd: rootDir,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    expect(
      resolveBuildInfo({
        rootDir,
        env: { GITHUB_SHA: "a".repeat(40) },
        execFileSync: () => {
          throw new Error("git unavailable");
        },
        now: () => new Date("2026-07-10T01:02:03.000Z"),
      }).commit,
    ).toBe("a".repeat(40));
    expect(() =>
      resolveBuildInfo({
        rootDir,
        env: { GITHUB_SHA: "bad" },
        execFileSync: () => {
          throw new Error("git unavailable");
        },
      }),
    ).toThrow("GITHUB_SHA must be a full 40-character Git commit SHA.");
  });

  it("rejects abbreviated or malformed explicit commits", () => {
    expect(() => normalizeBuildCommit("abc1234")).toThrow(
      "GIT_COMMIT must be a full 40-character Git commit SHA.",
    );
    expect(() => normalizeBuildCommit("g".repeat(40))).toThrow(
      "GIT_COMMIT must be a full 40-character Git commit SHA.",
    );
  });

  it("normalizes valid UTC timestamps and rejects offsets or impossible dates", () => {
    expect(normalizeBuildTimestamp("2026-07-10T12:34:56.7Z")).toBe("2026-07-10T12:34:56.700Z");
    expect(() => normalizeBuildTimestamp("2026-07-10T12:34:56+00:00")).toThrow(
      "OPENCLAW_BUILD_TIMESTAMP must be an ISO-8601 UTC timestamp ending in Z.",
    );
    expect(() => normalizeBuildTimestamp("2026-02-30T12:34:56Z")).toThrow(
      "OPENCLAW_BUILD_TIMESTAMP must be a valid ISO-8601 UTC timestamp.",
    );
  });
});
