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

    const pnpmScopedPkg = path.join(
      repo,
      "node_modules",
      ".pnpm",
      "@esbuild+darwin-arm64@0.99.0",
      "node_modules",
      "@esbuild",
      "darwin-arm64",
    );
    fs.mkdirSync(path.join(pnpmScopedPkg, "bin"), { recursive: true });
    fs.writeFileSync(
      path.join(pnpmScopedPkg, "package.json"),
      JSON.stringify({
        name: "@esbuild/darwin-arm64",
        version: "0.99.0",
        bin: { esbuild: "bin/esbuild" },
      }),
    );
    const nativeEsbuild = path.join(pnpmScopedPkg, "bin", "esbuild");
    fs.writeFileSync(nativeEsbuild, "\u007fELFmockbinary");
    fs.chmodSync(nativeEsbuild, 0o600);

    const distCli = path.join(repo, "dist", "runtime.mjs");
    fs.mkdirSync(path.dirname(distCli), { recursive: true });
    fs.writeFileSync(distCli, '#!/usr/bin/env node\nconsole.log("dist")\n');
    fs.chmodSync(distCli, 0o600);

    const extensionRoot = path.join(repo, "extensions", "demo-ext");
    const extensionManifest = path.join(extensionRoot, "openclaw.plugin.json");
    const extensionData = path.join(extensionRoot, "data", "cache.json");
    fs.mkdirSync(path.dirname(extensionData), { recursive: true });
    fs.writeFileSync(extensionManifest, '{"id":"demo-ext"}\n');
    fs.writeFileSync(extensionData, '{"ok":true}\n');

    fs.chmodSync(path.join(repo, "docs", "note.txt"), 0o755);
    fs.chmodSync(path.join(repo, "scripts", "tool.sh"), 0o644);
    fs.chmodSync(path.join(repo, "extensions"), 0o700);
    fs.chmodSync(extensionRoot, 0o700);
    fs.chmodSync(path.join(extensionRoot, "data"), 0o700);
    fs.chmodSync(extensionManifest, 0o600);
    fs.chmodSync(extensionData, 0o600);

    execFileSync(
      "bash",
      [path.resolve(process.cwd(), "scripts/fleet/releasectl"), "repair-perms", "--repo", repo],
      { cwd: process.cwd(), stdio: "ignore" },
    );

    expect(modeOf(path.join(repo, "docs", "note.txt"))).toBe(0o644);
    expect(modeOf(path.join(repo, "scripts", "tool.sh"))).toBe(0o755);
    expect(modeOf(realCli)).toBe(0o755);
    expect(modeOf(nativeEsbuild)).toBe(0o755);
    expect(modeOf(distCli)).toBe(0o755);
    expect(modeOf(path.join(repo, "extensions"))).toBe(0o755);
    expect(modeOf(extensionRoot)).toBe(0o755);
    expect(modeOf(path.join(extensionRoot, "data"))).toBe(0o755);
    expect(modeOf(extensionManifest)).toBe(0o644);
    expect(modeOf(extensionData)).toBe(0o644);
  });
});
