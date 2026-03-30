import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("staging deploy runtime env", () => {
  it("forces HOME-scoped XDG/PNPM paths instead of inheriting caller values", () => {
    const scriptPath = path.resolve(process.cwd(), "scripts/fleet/internal/staging-deploy.sh");
    const script = fs.readFileSync(scriptPath, "utf8");

    expect(script).toContain('export XDG_CONFIG_HOME="$HOME/.config"');
    expect(script).toContain('export XDG_CACHE_HOME="$HOME/.cache"');
    expect(script).toContain('export PNPM_HOME="$HOME/.local/share/pnpm"');
    expect(script).toContain('export TMPDIR="$HOME/tmp"');

    expect(script).not.toContain("${PNPM_HOME:-");
    expect(script).not.toContain("${XDG_CONFIG_HOME:-");
    expect(script).not.toContain("${XDG_CACHE_HOME:-");
  });
});
