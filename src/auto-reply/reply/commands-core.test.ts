import { afterEach, describe, expect, it, vi } from "vitest";
import * as internalHooks from "../../hooks/internal-hooks.js";
import type { HandleCommandsParams } from "./commands-types.js";

const { emitResetCommandHooks } = await import("./commands-core.js");

describe("emitResetCommandHooks", () => {
  async function runBeforeResetContext(sessionKey?: string) {
    const command = {
      surface: "discord",
      senderId: "rai",
      channel: "discord",
      from: "discord:rai",
      to: "discord:bot",
      resetHookTriggered: false,
    } as HandleCommandsParams["command"];

    const hookSpy = vi.spyOn(internalHooks, "triggerInternalHook").mockResolvedValue(undefined);

    await emitResetCommandHooks({
      action: "new",
      ctx: {} as HandleCommandsParams["ctx"],
      cfg: {} as HandleCommandsParams["cfg"],
      command,
      sessionKey,
      previousSessionEntry: {
        sessionId: "prev-session",
      } as HandleCommandsParams["previousSessionEntry"],
      workspaceDir: "/tmp/openclaw-workspace",
    });

    expect(hookSpy).toHaveBeenCalledTimes(1);
    const [event] = hookSpy.mock.calls[0] ?? [];
    return event?.context;
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes the bound agent id to before_reset hooks for multi-agent session keys", async () => {
    const ctx = await runBeforeResetContext("agent:navi:main");
    expect(ctx).toMatchObject({
      agentId: "navi",
      sessionId: "prev-session",
      workspaceDir: "/tmp/openclaw-workspace",
    });
  });

  it("falls back to main when the reset hook has no session key", async () => {
    const ctx = await runBeforeResetContext(undefined);
    expect(ctx).toMatchObject({
      agentId: "main",
      sessionId: "prev-session",
      workspaceDir: "/tmp/openclaw-workspace",
    });
  });

  it("keeps the main-agent path on the main agent workspace", async () => {
    const ctx = await runBeforeResetContext("agent:main:main");
    expect(ctx).toMatchObject({
      agentId: "main",
      sessionId: "prev-session",
      workspaceDir: "/tmp/openclaw-workspace",
    });
  });
});
