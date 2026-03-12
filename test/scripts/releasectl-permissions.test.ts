import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const modeOf = (p: string): number => fs.statSync(p).mode & 0o777;

describe("releasectl permission normalization", () => {
  it("restores tracked index modes and runtime entrypoint executability", () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "releasectl-perms-"));
    tempDirs.push(repo);

    execFileSync("git", ["init"], { cwd: repo, stdio: "ignore" });
    execFileSync("git", ["config", "user.email", "test@example.com"], {
      cwd: repo,
      stdio: "ignore",
    });
    execFileSync("git", ["config", "user.name", "Test User"], { cwd: repo, stdio: "ignore" });

    fs.mkdirSync(path.join(repo, "docs"), { recursive: true });
    fs.writeFileSync(path.join(repo, "docs", "note.txt"), "hello\n");

    fs.mkdirSync(path.join(repo, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(repo, "scripts", "tool.sh"), "#!/usr/bin/env bash\necho ok\n");
    fs.chmodSync(path.join(repo, "scripts", "tool.sh"), 0o755);

    execFileSync("git", ["add", "docs/note.txt", "scripts/tool.sh"], {
      cwd: repo,
      stdio: "ignore",
    });
    execFileSync("git", ["commit", "-m", "seed"], { cwd: repo, stdio: "ignore" });

    const pkgBin = path.join(repo, "node_modules", "pkg", "bin");
    const dotBin = path.join(repo, "node_modules", ".bin");
    fs.mkdirSync(pkgBin, { recursive: true });
    fs.mkdirSync(dotBin, { recursive: true });

    const realCli = path.join(pkgBin, "cli.js");
    fs.writeFileSync(realCli, '#!/usr/bin/env node\nconsole.log("ok")\n');
    fs.chmodSync(realCli, 0o600);

    fs.symlinkSync(path.join("..", "pkg", "bin", "cli.js"), path.join(dotBin, "cli"));

    const distCli = path.join(repo, "dist", "runtime.mjs");
    fs.mkdirSync(path.dirname(distCli), { recursive: true });
    fs.writeFileSync(distCli, '#!/usr/bin/env node\nconsole.log("dist")\n');
    fs.chmodSync(distCli, 0o600);

    fs.chmodSync(path.join(repo, "docs", "note.txt"), 0o755);
    fs.chmodSync(path.join(repo, "scripts", "tool.sh"), 0o644);

    execFileSync(
      "bash",
      [path.resolve(process.cwd(), "scripts/fleet/releasectl"), "repair-perms", "--repo", repo],
      { cwd: process.cwd(), stdio: "ignore" },
    );

    expect(modeOf(path.join(repo, "docs", "note.txt"))).toBe(0o644);
    expect(modeOf(path.join(repo, "scripts", "tool.sh"))).toBe(0o755);
    expect(modeOf(realCli)).toBe(0o755);
    expect(modeOf(distCli)).toBe(0o755);
  });
});
