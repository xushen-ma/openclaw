/**
 * Tests command status runtime lazy loading and direct status reply behavior.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as logger from "../logger.js";

const buildStatusReply = vi.fn(async (params: unknown) => params);
const loadSessionEntry = vi.fn();
const resolveSessionAgentId = vi.fn();
const listAgentEntries = vi.fn();
const resolveDefaultModelForAgent = vi.fn();
const resolveDefaultModel = vi.fn();
const createModelSelectionState = vi.fn();
const resolveCurrentDirectiveLevels = vi.fn();

vi.mock("../auto-reply/reply/commands-status.js", () => ({
  buildStatusReply,
}));

vi.mock("../gateway/session-utils.js", () => ({
  loadGatewaySessionEntryReadOnly: loadSessionEntry,
}));

vi.mock("../agents/agent-scope.js", () => ({
  listAgentEntries,
  resolveSessionAgentId,
}));

vi.mock("../agents/model-selection.js", () => ({
  resolveDefaultModelForAgent,
}));

vi.mock("../auto-reply/reply/directive-handling.defaults.js", () => ({
  resolveDefaultModel,
}));

vi.mock("../auto-reply/reply/model-selection.js", () => ({
  createModelSelectionState,
}));

vi.mock("../auto-reply/reply/directive-handling.levels.js", () => ({
  resolveCurrentDirectiveLevels,
}));

const { resolveDirectStatusReplyForSessionCore } = await import("./command-status.runtime.js");

function expectResolvedReasoningLevel(value: unknown, expected: string) {
  expect((value as { resolvedReasoningLevel?: unknown }).resolvedReasoningLevel).toBe(expected);
}

function requireBuildStatusReplyParams(index = 0): unknown {
  const call = buildStatusReply.mock.calls[index];
  if (!call) {
    throw new Error(`expected buildStatusReply call ${index}`);
  }
  return call[0];
}

describe("resolveDirectStatusReplyForSessionCore", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("preserves the direct read rejection when the diagnostic sink throws", async () => {
    vi.stubEnv("OPENCLAW_STATUS_DIAGNOSTICS", "1");
    const error = new DOMException("private request cancellation", "AbortError");
    loadSessionEntry.mockImplementation(() => {
      throw error;
    });
    const sink = vi.spyOn(logger, "logError").mockImplementation(() => {
      throw new Error("sink failed");
    });
    await expect(
      resolveDirectStatusReplyForSessionCore({
        cfg: {},
        sessionKey: "agent:main:private",
        channel: "discord",
        senderIsOwner: true,
        isAuthorizedSender: true,
        isGroup: false,
        defaultGroupActivation: () => "always",
      }),
    ).rejects.toBe(error);
    expect(sink).toHaveBeenCalledWith(expect.stringContaining('"phase":"session-read"'));
    expect(sink).not.toHaveBeenCalledWith(expect.stringContaining("private"));
  });
  beforeEach(() => {
    buildStatusReply.mockReset();
    loadSessionEntry.mockReset();
    resolveSessionAgentId.mockReset();
    listAgentEntries.mockReset();
    resolveDefaultModelForAgent.mockReset();
    resolveDefaultModel.mockReset();
    createModelSelectionState.mockReset();
    resolveCurrentDirectiveLevels.mockReset();

    buildStatusReply.mockImplementation(async (params: unknown) => params);
    loadSessionEntry.mockReturnValue({
      cfg: {
        agents: {
          defaults: {
            reasoningDefault: "off",
          },
        },
      },
      canonicalKey: "main",
      entry: {
        sessionId: "sess-main",
      },
      store: {},
      storePath: "/tmp/sessions.json",
    });
    resolveSessionAgentId.mockReturnValue("main");
    listAgentEntries.mockReturnValue([]);
    resolveDefaultModelForAgent.mockReturnValue({ provider: "openai", model: "gpt-5.4" });
    resolveDefaultModel.mockReturnValue({ defaultProvider: "openai", defaultModel: "gpt-5.4" });
    createModelSelectionState.mockResolvedValue({
      resolveThinkingCatalog: vi.fn(async () => []),
      resolveDefaultThinkingLevel: vi.fn(async () => "off"),
      resolveDefaultReasoningLevel: vi.fn(async () => "on"),
    });
    resolveCurrentDirectiveLevels.mockResolvedValue({
      currentThinkLevel: "off",
      currentFastMode: false,
      currentVerboseLevel: "off",
      currentReasoningLevel: "off",
      currentElevatedLevel: "off",
    });
  });

  it("treats agentCfg reasoningDefault as explicit for direct /status", async () => {
    const result = await resolveDirectStatusReplyForSessionCore({
      cfg: {},
      sessionKey: "main",
      channel: "cli",
      senderIsOwner: true,
      isAuthorizedSender: true,
      isGroup: false,
      defaultGroupActivation: () => "always",
    });

    expect(buildStatusReply).toHaveBeenCalledOnce();
    expectResolvedReasoningLevel(requireBuildStatusReplyParams(), "off");
    expectResolvedReasoningLevel(result, "off");
  });

  it.each(
    [
      { source: "configured reasoning defaults", session: false },
      { source: "session reasoning state", session: true },
    ].flatMap(({ source, session }) =>
      [true, false].map((isAuthorizedSender) => ({
        source,
        session,
        isAuthorizedSender,
        action: isAuthorizedSender ? "allows" : "hides",
      })),
    ),
  )("$action $source for direct /status senders", async ({ session, isAuthorizedSender }) => {
    loadSessionEntry.mockReturnValue({
      cfg: session ? {} : { agents: { defaults: { reasoningDefault: "stream" } } },
      canonicalKey: "main",
      entry: { sessionId: "sess-main", ...(session ? { reasoningLevel: "stream" } : {}) },
      store: {},
      storePath: "/tmp/sessions.json",
    });
    resolveCurrentDirectiveLevels.mockResolvedValueOnce({
      currentThinkLevel: "off",
      currentFastMode: false,
      currentVerboseLevel: "off",
      currentReasoningLevel: "stream",
      currentElevatedLevel: "off",
    });

    const result = await resolveDirectStatusReplyForSessionCore({
      cfg: {},
      sessionKey: "main",
      channel: "cli",
      senderIsOwner: false,
      isAuthorizedSender,
      isGroup: false,
      defaultGroupActivation: () => "always",
    });

    expectResolvedReasoningLevel(result, isAuthorizedSender ? "stream" : "off");
  });
});
