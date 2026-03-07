import { describe, expect, it, vi, beforeEach } from "vitest";

function assistantToolCall(id: string): unknown {
  return {
    role: "assistant",
    content: [
      {
        type: "toolCall",
        id,
        name: "search",
        input: {},
      },
    ],
  };
}

function toolResult(id: string, text: string): unknown {
  return {
    role: "toolResult",
    toolCallId: id,
    content: [{ type: "text", text }],
  };
}

const mocks = vi.hoisted(() => ({
  resolveSessionAgentId: vi.fn(() => "agent-from-key"),
  consumeRestartSentinel: vi.fn(async () => ({
    payload: {
      sessionKey: "agent:main:main",
      deliveryContext: {
        channel: "whatsapp",
        to: "+15550002",
        accountId: "acct-2",
      },
    },
  })),
  formatRestartSentinelMessage: vi.fn(() => "restart message"),
  summarizeRestartSentinel: vi.fn(() => "restart summary"),
  resolveMainSessionKeyFromConfig: vi.fn(() => "agent:main:main"),
  parseSessionThreadInfo: vi.fn(() => ({ baseSessionKey: null, threadId: undefined })),
  loadSessionEntry: vi.fn(() => ({ cfg: {}, storePath: "/tmp/store.json", entry: {} })),
  readSessionMessages: vi.fn((): unknown[] => []),
  agentCommandFromIngress: vi.fn(async () => undefined),
  resolveAnnounceTargetFromKey: vi.fn(() => null),
  deliveryContextFromSession: vi.fn(() => undefined),
  mergeDeliveryContext: vi.fn((a?: Record<string, unknown>, b?: Record<string, unknown>) => ({
    ...b,
    ...a,
  })),
  normalizeChannelId: vi.fn((channel: string) => channel),
  resolveOutboundTarget: vi.fn(() => ({ ok: true as const, to: "+15550002" })),
  deliverOutboundPayloads: vi.fn(async () => []),
  enqueueSystemEvent: vi.fn(),
}));

vi.mock("../agents/agent-scope.js", () => ({
  resolveSessionAgentId: mocks.resolveSessionAgentId,
}));

vi.mock("../infra/restart-sentinel.js", () => ({
  consumeRestartSentinel: mocks.consumeRestartSentinel,
  formatRestartSentinelMessage: mocks.formatRestartSentinelMessage,
  summarizeRestartSentinel: mocks.summarizeRestartSentinel,
}));

vi.mock("../config/sessions.js", () => ({
  resolveMainSessionKeyFromConfig: mocks.resolveMainSessionKeyFromConfig,
}));

vi.mock("../commands/agent.js", () => ({
  agentCommandFromIngress: mocks.agentCommandFromIngress,
}));

vi.mock("../config/sessions/delivery-info.js", () => ({
  parseSessionThreadInfo: mocks.parseSessionThreadInfo,
}));

vi.mock("./session-utils.js", () => ({
  loadSessionEntry: mocks.loadSessionEntry,
  readSessionMessages: mocks.readSessionMessages,
}));

vi.mock("../agents/tools/sessions-send-helpers.js", () => ({
  resolveAnnounceTargetFromKey: mocks.resolveAnnounceTargetFromKey,
}));

vi.mock("../utils/delivery-context.js", () => ({
  deliveryContextFromSession: mocks.deliveryContextFromSession,
  mergeDeliveryContext: mocks.mergeDeliveryContext,
}));

vi.mock("../channels/plugins/index.js", () => ({
  normalizeChannelId: mocks.normalizeChannelId,
}));

vi.mock("../infra/outbound/targets.js", () => ({
  resolveOutboundTarget: mocks.resolveOutboundTarget,
}));

vi.mock("../infra/outbound/deliver.js", () => ({
  deliverOutboundPayloads: mocks.deliverOutboundPayloads,
}));

vi.mock("../infra/system-events.js", () => ({
  enqueueSystemEvent: mocks.enqueueSystemEvent,
}));

const { scheduleRestartSentinelWake } = await import("./server-restart-sentinel.js");

describe("scheduleRestartSentinelWake", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.consumeRestartSentinel.mockResolvedValue({
      payload: {
        sessionKey: "agent:main:main",
        deliveryContext: {
          channel: "whatsapp",
          to: "+15550002",
          accountId: "acct-2",
        },
      },
    });
    mocks.loadSessionEntry.mockReturnValue({ cfg: {}, storePath: "/tmp/store.json", entry: {} });
    mocks.readSessionMessages.mockReturnValue([]);
  });

  it("forwards session context to outbound delivery", async () => {
    await scheduleRestartSentinelWake({ deps: {} as never });

    expect(mocks.deliverOutboundPayloads).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "whatsapp",
        to: "+15550002",
        session: { key: "agent:main:main", agentId: "agent-from-key" },
      }),
    );
    expect(mocks.enqueueSystemEvent).not.toHaveBeenCalled();
  });

  it("auto-triggers recovery when the transcript tail is interrupted with missing tool results", async () => {
    mocks.loadSessionEntry.mockReturnValue({
      cfg: {},
      storePath: "/tmp/store.json",
      entry: {
        sessionId: "sess-1",
      },
    });
    mocks.readSessionMessages.mockReturnValue([assistantToolCall("tool-1")]);

    await scheduleRestartSentinelWake({ deps: {} as never });

    expect(mocks.agentCommandFromIngress).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionKey: "agent:main:main",
        sessionId: "sess-1",
        message: expect.stringContaining("results are still missing from the transcript"),
        deliver: true,
        senderIsOwner: true,
      }),
      undefined,
      {} as never,
    );
    expect(mocks.deliverOutboundPayloads).not.toHaveBeenCalled();
  });

  it("falls back to normal restart delivery when transcript-tail recovery throws", async () => {
    mocks.loadSessionEntry.mockReturnValue({
      cfg: {},
      storePath: "/tmp/store.json",
      entry: {
        sessionId: "sess-1",
      },
    });
    mocks.readSessionMessages.mockReturnValue([assistantToolCall("tool-1")]);
    mocks.agentCommandFromIngress.mockRejectedValueOnce(new Error("resume failed"));

    await scheduleRestartSentinelWake({ deps: {} as never });

    expect(mocks.agentCommandFromIngress).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionKey: "agent:main:main",
        sessionId: "sess-1",
        message: expect.stringContaining("results are still missing from the transcript"),
        deliver: true,
        senderIsOwner: true,
      }),
      undefined,
      {} as never,
    );
    expect(mocks.deliverOutboundPayloads).toHaveBeenCalledTimes(1);
  });

  it("does not auto-recover when no interrupted tail exists", async () => {
    mocks.loadSessionEntry.mockReturnValue({
      cfg: {},
      storePath: "/tmp/store.json",
      entry: {
        sessionId: "sess-1",
      },
    });
    mocks.readSessionMessages.mockReturnValue([
      assistantToolCall("tool-1"),
      {
        role: "user",
        content: [{ type: "text", text: "new user message" }],
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "latest assistant turn" }],
      },
    ]);

    await scheduleRestartSentinelWake({ deps: {} as never });

    expect(mocks.agentCommandFromIngress).not.toHaveBeenCalled();
    expect(mocks.deliverOutboundPayloads).toHaveBeenCalled();
  });

  it("ignores legacy recovery flags once the transcript tail is no longer interrupted", async () => {
    mocks.loadSessionEntry.mockReturnValue({
      cfg: {},
      storePath: "/tmp/store.json",
      entry: {
        sessionId: "sess-1",
        syntheticRecoveryPending: true,
        syntheticRecoveryAttempted: true,
      },
    });
    mocks.readSessionMessages.mockReturnValue([
      assistantToolCall("tool-1"),
      toolResult("tool-1", "done"),
    ]);

    await scheduleRestartSentinelWake({ deps: {} as never });

    expect(mocks.agentCommandFromIngress).not.toHaveBeenCalled();
    expect(mocks.deliverOutboundPayloads).toHaveBeenCalledTimes(1);
  });
});
