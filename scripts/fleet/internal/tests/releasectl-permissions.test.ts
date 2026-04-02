import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const scriptPath = path.join(process.cwd(), "scripts", "fleet", "releasectl");
const tempRoots: string[] = [];

type RunResult = {
  stdout: string;
  stderr: string;
  status: number;
};

function runReleaseCtl(args: string[]): RunResult {
  const result = spawnSync("bash", [scriptPath, ...args], {
    encoding: "utf8",
    env: { ...process.env },
  });
  if (result.status !== 0) {
    throw new Error(
      `releasectl failed (${String(result.status)}): ${String(result.stderr ?? "").trim()}\n${String(result.stdout ?? "").trim()}`,
    );
  }
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    status: result.status ?? 0,
  };
}

function mktempRoot(prefix: string) {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

function modeString(target: string) {
  return (statSync(target).mode & 0o777).toString(8).padStart(3, "0");
}

function collectModes(targets: string[]) {
  return targets.toSorted().reduce<Record<string, string>>((acc, target) => {
    acc[target] = modeString(target);
    return acc;
  }, {});
}

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) {
      rmSync(root, { force: true, recursive: true });
    }
  }
});

describe("releasectl permissions commands", () => {
  it("repair-perms normalizes directory and file permissions deterministically", () => {
    const root = mktempRoot("releasectl-perms-");
    const nested = path.join(root, "nested", "branch");
    const rootFile = path.join(root, "root-file.txt");
    const nestedFile = path.join(nested, "nested-file.txt");

    mkdirSync(nested, { recursive: true });
    writeFileSync(rootFile, "root");
    writeFileSync(nestedFile, "nested");
    chmodSync(root, 0o700);
    chmodSync(path.join(root, "nested"), 0o700);
    chmodSync(path.join(root, "nested", "branch"), 0o755);
    chmodSync(rootFile, 0o600);
    chmodSync(nestedFile, 0o600);

    runReleaseCtl(["repair-perms", root]);

    expect(modeString(root)).toBe("755");
    expect(modeString(path.join(root, "nested"))).toBe("755");
    expect(modeString(path.join(root, "nested", "branch"))).toBe("755");
    expect(modeString(rootFile)).toBe("644");
    expect(modeString(nestedFile)).toBe("644");

    const afterFirst = collectModes([root, path.join(root, "nested"), path.join(root, "nested", "branch"), rootFile, nestedFile]);
    runReleaseCtl(["repair-perms", nestedFile, rootFile, root]);
    const afterSecond = collectModes([root, path.join(root, "nested"), path.join(root, "nested", "branch"), rootFile, nestedFile]);

    expect(afterSecond).toEqual(afterFirst);
  });

  it("sanity-check sets secret files to 600", () => {
    const root = mktempRoot("releasectl-secrets-");
    const secretA = path.join(root, "secret-a.txt");
    const secretB = path.join(root, "secret-b.txt");

    writeFileSync(secretA, "alpha");
    writeFileSync(secretB, "beta");
    chmodSync(secretA, 0o644);
    chmodSync(secretB, 0o644);

    runReleaseCtl(["sanity-check", secretB, secretA]);

    expect(modeString(secretA)).toBe("600");
    expect(modeString(secretB)).toBe("600");
  });
});
