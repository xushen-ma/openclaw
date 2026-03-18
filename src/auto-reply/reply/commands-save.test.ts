import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../../config/config.js";
import { handleSaveCommand } from "./commands-save.js";
import { buildCommandTestParams } from "./commands.test-harness.js";

describe("handleSaveCommand", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("injects save prompt into ctx body and returns shouldContinue true", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-10T01:04:00.000Z"));

    const cfg = {
      commands: { text: true },
      channels: { whatsapp: { allowFrom: ["*"] } },
      agents: { defaults: { userTimezone: "Australia/Melbourne" } },
    } as OpenClawConfig;
    const params = buildCommandTestParams("/save", cfg);

    const result = await handleSaveCommand(params, true);

    expect(result).toEqual({ shouldContinue: true });
    expect(params.ctx.Body).toContain("memory/2026-03-10.md");
    expect(params.ctx.Body).toContain("send a short visible confirmation reply");
    expect(params.ctx.Body).not.toContain("Additional instructions:");
    expect(params.ctx.BodyStripped).toEqual(params.ctx.Body);

    vi.useRealTimers();
  });

  it("appends custom instructions for /save: ...", async () => {
    const cfg = {
      commands: { text: true },
      channels: { whatsapp: { allowFrom: ["*"] } },
    } as OpenClawConfig;
    const params = buildCommandTestParams("/save: remember the deployment discussion", cfg);

    const result = await handleSaveCommand(params, true);

    expect(result).toEqual({ shouldContinue: true });
    expect(params.ctx.Body).toContain(
      "Additional instructions: remember the deployment discussion",
    );
  });

  it("uses configured /save prompt", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-10T01:04:00.000Z"));

    const cfg = {
      commands: {
        text: true,
        save: {
          prompt:
            "Write today to memory/YYYY-MM-DD.md and then acknowledge completion to the user.",
        },
      },
      channels: { whatsapp: { allowFrom: ["*"] } },
      agents: { defaults: { userTimezone: "Australia/Melbourne" } },
    } as OpenClawConfig;
    const params = buildCommandTestParams("/save", cfg);

    const result = await handleSaveCommand(params, true);

    expect(result).toEqual({ shouldContinue: true });
    expect(params.ctx.Body).toContain("memory/2026-03-10.md");
    expect(params.ctx.Body).not.toContain("capture what matters, skip the noise");

    vi.useRealTimers();
  });

  it("ignores unauthorized /save", async () => {
    const cfg = {
      commands: { text: true },
      channels: { whatsapp: { allowFrom: ["*"] } },
    } as OpenClawConfig;
    const params = buildCommandTestParams("/save", cfg);

    const result = await handleSaveCommand(
      {
        ...params,
        command: {
          ...params.command,
          isAuthorizedSender: false,
          senderId: "unauthorized",
        },
      },
      true,
    );

    expect(result).toEqual({ shouldContinue: false });
    expect(params.ctx.Body).toBe("/save"); // unchanged
  });
});
