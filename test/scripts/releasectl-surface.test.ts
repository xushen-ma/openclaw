import { execFileSync, spawnSync } from "node:child_process";
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

const releasectlPath = path.resolve(process.cwd(), "scripts/fleet/releasectl");

function makeHarness() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "releasectl-surface-"));
  tempDirs.push(root);

  const internalDir = path.join(root, "internal");
  fs.mkdirSync(internalDir, { recursive: true });

  const callsFile = path.join(root, "calls.log");
  const lockDir = path.join(root, "locks");
  fs.mkdirSync(lockDir, { recursive: true });

  fs.writeFileSync(
    path.join(internalDir, "permissions.sh"),
    `#!/usr/bin/env bash
normalize_repo_permissions() {
  local repo="\${1:-}"
  local mode="\${2:-}"
  echo "normalize:$repo:$mode" >> "$CALLS_FILE"
}
`,
  );

  fs.writeFileSync(
    path.join(internalDir, "staging-deploy.sh"),
    `#!/usr/bin/env bash
echo "staging:$*" >> "$CALLS_FILE"
`,
  );

  fs.writeFileSync(
    path.join(internalDir, "deploy.sh"),
    `#!/usr/bin/env bash
echo "deploy:$*" >> "$CALLS_FILE"
`,
  );

  fs.writeFileSync(
    path.join(internalDir, "rollback.sh"),
    `#!/usr/bin/env bash
echo "rollback:$*" >> "$CALLS_FILE"
`,
  );

  fs.writeFileSync(
    path.join(internalDir, "sync-installed-bundle.sh"),
    `#!/usr/bin/env bash
echo "bundle:$*" >> "$CALLS_FILE"
`,
  );

  fs.writeFileSync(
    path.join(internalDir, "fleet.env"),
    `#!/usr/bin/env bash
FLEET_LOCK_DIR="${lockDir}"
STAGING_LOCK_FILE="$FLEET_LOCK_DIR/staging.lock"
`,
  );

  for (const script of [
    "permissions.sh",
    "staging-deploy.sh",
    "deploy.sh",
    "rollback.sh",
    "sync-installed-bundle.sh",
  ]) {
    fs.chmodSync(path.join(internalDir, script), 0o755);
  }

  return { root, internalDir, callsFile, lockDir };
}

describe("releasectl command surface", () => {
  it("routes test-deploy and staging-deploy to internal staging-deploy", () => {
    const harness = makeHarness();

    const env = {
      ...process.env,
      RELEASECTL_INTERNAL_DIR: harness.internalDir,
      RELEASECTL_SKIP_SUDO_HANDOFF: "1",
      CALLS_FILE: harness.callsFile,
    };

    execFileSync("bash", [releasectlPath, "test-deploy", "--sha", "feature/abc"], { env });
    execFileSync("bash", [releasectlPath, "staging-deploy", "--sha", "abc123"], { env });

    const lines = fs.readFileSync(harness.callsFile, "utf8").trim().split("\n");
    expect(lines).toEqual([
      "staging:feature/abc",
      `normalize:${path.resolve(process.cwd())}:apply`,
      "staging:abc123",
      `normalize:${path.resolve(process.cwd())}:apply`,
    ]);
  });

  it("requires --sha for test-deploy", () => {
    const harness = makeHarness();
    const env = {
      ...process.env,
      RELEASECTL_INTERNAL_DIR: harness.internalDir,
      RELEASECTL_SKIP_SUDO_HANDOFF: "1",
      CALLS_FILE: harness.callsFile,
    };

    const out = spawnSync("bash", [releasectlPath, "test-deploy"], { env, encoding: "utf8" });
    expect(out.status).toBe(2);
    expect(out.stderr).toContain("missing required flag --sha");
  });

  it("routes bundle-sync to internal sync-installed-bundle helper", () => {
    const harness = makeHarness();

    const env = {
      ...process.env,
      RELEASECTL_INTERNAL_DIR: harness.internalDir,
      RELEASECTL_SKIP_SUDO_HANDOFF: "1",
      CALLS_FILE: harness.callsFile,
    };

    execFileSync("bash", [releasectlPath, "bundle-sync"], { env });
    execFileSync("bash", [releasectlPath, "bundle-sync", "--sync"], { env });

    const lines = fs.readFileSync(harness.callsFile, "utf8").trim().split("\n");
    expect(lines).toEqual(["bundle:--check", "bundle:--sync"]);
  });

  it("reports and releases test lane lock", () => {
    const harness = makeHarness();
    const env = {
      ...process.env,
      RELEASECTL_INTERNAL_DIR: harness.internalDir,
      RELEASECTL_SKIP_SUDO_HANDOFF: "1",
      CALLS_FILE: harness.callsFile,
    };
    const lockFile = path.join(harness.lockDir, "staging.lock");

    const free = spawnSync("bash", [releasectlPath, "test-status"], { env, encoding: "utf8" });
    expect(free.status).toBe(0);
    expect(free.stdout).toContain("test lane status: available");

    fs.writeFileSync(lockFile, "PID=999999\nOWNER=mini\n");

    const busy = spawnSync("bash", [releasectlPath, "test-status"], { env, encoding: "utf8" });
    expect(busy.status).toBe(0);
    expect(busy.stdout).toContain("test lane status: busy");
    expect(busy.stdout).toContain("pid_state=stale");

    const release = spawnSync("bash", [releasectlPath, "test-release"], { env, encoding: "utf8" });
    expect(release.status).toBe(0);
    expect(fs.existsSync(lockFile)).toBe(false);
  });
});
