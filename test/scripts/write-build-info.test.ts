import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  resolveBuildInfoVersion,
  resolveHeadForkVersion,
  writeBuildInfo,
} from "../../scripts/write-build-info.js";

const tempRoots: string[] = [];

function makeRepo(packageVersion = "2026.7.1"): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-build-info-"));
  tempRoots.push(root);
  fs.writeFileSync(
    path.join(root, "package.json"),
    `${JSON.stringify({ version: packageVersion })}\n`,
  );
  fs.writeFileSync(path.join(root, "README.md"), "fixture\n");
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["add", "."], { cwd: root, stdio: "ignore" });
  execFileSync(
    "git",
    [
      "-c",
      "user.name=OpenClaw Test",
      "-c",
      "user.email=test@example.org",
      "commit",
      "-m",
      "fixture",
    ],
    { cwd: root, stdio: "ignore" },
  );
  return root;
}

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

describe("write-build-info", () => {
  it("prefers an exact HEAD fork tag over package.json version", () => {
    const root = makeRepo();
    execFileSync("git", ["tag", "v2026.7.1"], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["tag", "v2026.7.1-x.2"], { cwd: root, stdio: "ignore" });

    expect(resolveHeadForkVersion(root)).toBe("2026.7.1-x.2");
    expect(resolveBuildInfoVersion(root)).toBe("2026.7.1-x.2");
  });

  it("uses the highest matching fork tag when several point at HEAD", () => {
    const root = makeRepo();
    execFileSync("git", ["tag", "v2026.7.1-x.1"], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["tag", "v2026.7.1-x.3"], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["tag", "v2026.7.1-beta.1"], { cwd: root, stdio: "ignore" });

    expect(resolveHeadForkVersion(root)).toBe("2026.7.1-x.3");
  });

  it("falls back to package.json version when no exact HEAD fork tag exists", () => {
    const root = makeRepo("2026.7.1");
    execFileSync("git", ["tag", "v2026.7.1"], { cwd: root, stdio: "ignore" });

    expect(resolveHeadForkVersion(root)).toBeNull();
    expect(resolveBuildInfoVersion(root)).toBe("2026.7.1");
  });

  it("writes build-info.json with the resolved fork version", () => {
    const root = makeRepo();
    execFileSync("git", ["tag", "v2026.7.1-x.4"], { cwd: root, stdio: "ignore" });

    writeBuildInfo(root);

    const buildInfo = JSON.parse(
      fs.readFileSync(path.join(root, "dist", "build-info.json"), "utf8"),
    ) as { version?: string; commit?: string; builtAt?: string };
    expect(buildInfo.version).toBe("2026.7.1-x.4");
    expect(buildInfo.commit).toMatch(/^[a-f0-9]{40}$/);
    expect(buildInfo.builtAt).toMatch(/\d{4}-\d{2}-\d{2}T/);
  });
});
