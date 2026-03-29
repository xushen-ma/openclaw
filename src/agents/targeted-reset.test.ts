import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import { loadSessionStore } from "../config/sessions/store.js";
import { performTargetedReset } from "./targeted-reset.js";

vi.mock("../gateway/session-utils.fs.js", () => ({
  archiveSessionTranscripts: vi.fn(),
}));

vi.mock("../auto-reply/reply/commands-core.js", () => ({
  emitResetCommandHooks: vi.fn().mockResolvedValue(undefined),
}));

function makeCfg(storePath: string): OpenClawConfig {
  return {
    session: { store: storePath },
    agents: { defaults: { workspace: "/tmp/openclaw-workspace" } },
  } as unknown as OpenClawConfig;
}

describe("performTargetedReset", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it("resets the target session without mutating the requester session", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-target-reset-"));
    tempDirs.push(dir);
    const storePath = path.join(dir, "sessions.json");
    fs.writeFileSync(
      storePath,
      JSON.stringify(
        {
          "agent:mini:main": { sessionId: "req-1", updatedAt: 100 },
          "agent:kiki:main": {
            sessionId: "target-1",
            updatedAt: 200,
            totalTokens: 9000,
            inputTokens: 1000,
            outputTokens: 2000,
            contextTokens: 3000,
          },
        },
        null,
        2,
      ),
    );

    const result = await performTargetedReset({
      cfg: makeCfg(storePath),
      requesterSessionKey: "agent:mini:main",
      targetSessionKey: "agent:kiki:main",
      requesterAuthorized: true,
      rebrief: "Reload the PM handover.",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.targetSessionKey).toBe("agent:kiki:main");
    expect(result.previousSessionId).toBe("target-1");
    expect(result.newSessionId).not.toBe("target-1");
    expect(result.rebriefDisposition).toBe("injected");

    const saved = loadSessionStore(storePath, { skipCache: true });
    expect(saved["agent:mini:main"]?.sessionId).toBe("req-1");
    expect(saved["agent:kiki:main"]?.sessionId).toBe(result.newSessionId);
    expect(saved["agent:kiki:main"]?.totalTokens).toBeUndefined();
    expect(saved["agent:kiki:main"]?.contextTokens).toBeUndefined();
  });

  it("rejects unauthorized requester resets", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-target-reset-"));
    tempDirs.push(dir);
    const storePath = path.join(dir, "sessions.json");
    fs.writeFileSync(
      storePath,
      JSON.stringify({ "agent:kiki:main": { sessionId: "target-1", updatedAt: 200 } }),
    );

    const result = await performTargetedReset({
      cfg: makeCfg(storePath),
      requesterSessionKey: "agent:mini:main",
      targetSessionKey: "agent:kiki:main",
      requesterAuthorized: false,
    });

    expect(result).toMatchObject({ ok: false, code: "unauthorized" });
  });

  it("rejects requester-target conflicts", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-target-reset-"));
    tempDirs.push(dir);
    const storePath = path.join(dir, "sessions.json");
    fs.writeFileSync(
      storePath,
      JSON.stringify({ "agent:mini:main": { sessionId: "req-1", updatedAt: 100 } }),
    );

    const result = await performTargetedReset({
      cfg: makeCfg(storePath),
      requesterSessionKey: "agent:mini:main",
      targetSessionKey: "agent:mini:main",
      requesterAuthorized: true,
    });

    expect(result).toMatchObject({ ok: false, code: "requester_target_conflict" });
  });
});
