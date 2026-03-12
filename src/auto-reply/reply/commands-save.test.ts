import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../../config/config.js";
import { handleSaveCommand } from "./commands-save.js";
import { buildCommandTestParams } from "./commands.test-harness.js";

const enqueueSystemEventMock = vi.hoisted(() => vi.fn());

vi.mock("../../infra/system-events.js", () => ({
  enqueueSystemEvent: enqueueSystemEventMock,
}));

describe("handleSaveCommand", () => {
  beforeEach(() => {
    enqueueSystemEventMock.mockReset();
  });

  it("injects default save prompt for /save and returns shouldContinue false", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-10T01:04:00.000Z"));

    const cfg = {
      commands: { text: true },
      channels: { whatsapp: { allowFrom: ["*"] } },
      agents: { defaults: { userTimezone: "Australia/Melbourne" } },
    } as OpenClawConfig;
    const params = buildCommandTestParams("/save", cfg);

    const result = await handleSaveCommand(params, true);

    expect(result).toEqual({
      shouldContinue: false,
      reply: { text: "Saving this conversation to memory now." },
    });
    expect(enqueueSystemEventMock).toHaveBeenCalledTimes(1);
    expect(enqueueSystemEventMock.mock.calls[0]?.[0]).toContain("memory/2026-03-10.md");
    expect(enqueueSystemEventMock.mock.calls[0]?.[0]).toContain(
      "send a short visible confirmation reply",
    );
    expect(enqueueSystemEventMock.mock.calls[0]?.[0]).not.toContain("Additional instructions:");
    expect(enqueueSystemEventMock).toHaveBeenCalledWith(expect.any(String), {
      sessionKey: "agent:main:main",
    });

    vi.useRealTimers();
  });

  it("appends custom instructions for /save: ...", async () => {
    const cfg = {
      commands: { text: true },
      channels: { whatsapp: { allowFrom: ["*"] } },
    } as OpenClawConfig;
    const params = buildCommandTestParams("/save: remember the deployment discussion", cfg);

    const result = await handleSaveCommand(params, true);

    expect(result).toEqual({
      shouldContinue: false,
      reply: { text: "Saving this conversation to memory now." },
    });
    const prompt = enqueueSystemEventMock.mock.calls.at(-1)?.[0] as string;
    expect(prompt).toContain("Additional instructions: remember the deployment discussion");
  });

  it("uses configured /save prompt and confirmation", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-10T01:04:00.000Z"));

    const cfg = {
      commands: {
        text: true,
        save: {
          prompt:
            "Write today to memory/YYYY-MM-DD.md and then acknowledge completion to the user.",
          confirmation: "Right away — saving it.",
        },
      },
      channels: { whatsapp: { allowFrom: ["*"] } },
      agents: { defaults: { userTimezone: "Australia/Melbourne" } },
    } as OpenClawConfig;
    const params = buildCommandTestParams("/save", cfg);

    const result = await handleSaveCommand(params, true);

    expect(result).toEqual({
      shouldContinue: false,
      reply: { text: "Right away — saving it." },
    });
    expect(enqueueSystemEventMock.mock.calls.at(-1)?.[0]).toContain("memory/2026-03-10.md");
    expect(enqueueSystemEventMock.mock.calls.at(-1)?.[0]).not.toContain(
      "capture what matters, skip the noise",
    );

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
    expect(enqueueSystemEventMock).not.toHaveBeenCalled();
  });
});
