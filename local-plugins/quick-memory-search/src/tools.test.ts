import { describe, expect, it, vi } from "vitest";
import { DEFAULT_AGENT_HEADER } from "./ov-http.js";
import { createQuickMemorySearchTool, createQuickSessionSearchTool } from "./tools.js";

const httpConfig = {
  perAgentBaseUrl: "http://127.0.0.1:8091",
  agentRouting: "header" as const,
  agentHeaderName: DEFAULT_AGENT_HEADER,
  requestTimeoutMs: 1000,
};

describe("quick memory tools", () => {
  it("passes the current agent id to per-agent memory search and reports routing", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        result: { total: 1, resources: [{ uri: "memory://one", score: 0.92, abstract: "hit" }] },
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const tool = createQuickMemorySearchTool({ httpConfig, agentId: "ben" });
      const result = await tool.execute("call-1", { query: "decision", maxResults: 1 });
      expect(fetchMock).toHaveBeenCalledWith(
        "http://127.0.0.1:8091/api/v1/search/find",
        expect.objectContaining({
          headers: expect.objectContaining({ [DEFAULT_AGENT_HEADER]: "ben" }),
        }),
      );
      expect(result.details).toMatchObject({
        routing: "per-agent",
        agentId: "ben",
        results: [{ path: "memory://one", source: "openviking-agent-http" }],
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("does not use legacy memory fallback unless a legacy endpoint is configured", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        text: async () => "offline",
      })),
    );
    try {
      const tool = createQuickMemorySearchTool({ httpConfig, agentId: "mini" });
      const result = await tool.execute("call-1", { query: "notes" });
      expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
      expect(result.details).toMatchObject({
        results: [],
        fallback: "Use memory_search as fallback.",
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("uses explicit local session fallback after per-agent session HTTP fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        text: async () => "offline",
      })),
    );
    const runLocalSearch = vi.fn(async () => ({
      total: 1,
      items: [{ uri: "session://one", score: 0.8, abstract: "session hit" }],
    }));
    try {
      const tool = createQuickSessionSearchTool({
        httpConfig,
        agentId: "mini",
        sessionFallback: {
          enabled: true,
          memoryRoot: "/tmp/ov",
          pythonBin: "/tmp/python",
          timeoutMs: 1000,
        },
        runLocalSearch,
      });
      const result = await tool.execute("call-1", { query: "meeting", maxResults: 1 });

      expect(runLocalSearch).toHaveBeenCalledWith(
        expect.objectContaining({ storePath: "/tmp/ov/mini-sessions", pythonBin: "/tmp/python" }),
      );
      expect(result.details).toMatchObject({
        routing: "local",
        provider: "openviking-sessions-local",
        results: [{ path: "session://one" }],
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("does not run local session fallback unless explicitly enabled", async () => {
    const runLocalSearch = vi.fn();
    const tool = createQuickSessionSearchTool({
      httpConfig: { ...httpConfig, perAgentBaseUrl: undefined },
      agentId: "mini",
      sessionFallback: { enabled: false, timeoutMs: 1000 },
      runLocalSearch,
    });
    const result = await tool.execute("call-1", { query: "meeting" });

    expect(runLocalSearch).not.toHaveBeenCalled();
    expect(result.details).toMatchObject({
      unavailable: true,
      fallback: "Use sessions_history as fallback.",
    });
  });
});
