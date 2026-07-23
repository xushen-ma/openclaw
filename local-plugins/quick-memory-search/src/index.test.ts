import { getToolPluginMetadata } from "openclaw/plugin-sdk/tool-plugin";
import { describe, expect, it, vi } from "vitest";
import pluginEntry from "./index.js";

describe("quick memory plugin entry", () => {
  it("declares identity and registers both tool factories", () => {
    const registerTool = vi.fn();
    const registerService = vi.fn();
    const registerGatewayMethod = vi.fn();
    pluginEntry.register({
      pluginConfig: { perAgentOvBaseUrl: "http://127.0.0.1:8091" },
      registerTool,
      registerService,
      registerGatewayMethod,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    } as never);

    expect(pluginEntry.id).toBe("quick-memory-search");
    expect(getToolPluginMetadata(pluginEntry)?.tools.map((tool) => tool.name)).toEqual([
      "quick_memory_search",
      "quick_session_search",
    ]);
    expect(registerTool).toHaveBeenCalledTimes(2);
    expect(registerTool.mock.calls.map((call) => call[0]({ agentId: "ben" }).name)).toEqual([
      "quick_memory_search",
      "quick_session_search",
    ]);
    expect(registerService).toHaveBeenCalledWith(
      expect.objectContaining({ id: "quick-memory-search.status" }),
    );
    expect(registerGatewayMethod).toHaveBeenCalledWith(
      "quick-memory-search.status",
      expect.any(Function),
      { scope: "operator.read" },
    );
  });

  it("reports status without exposing endpoint values", async () => {
    const registerGatewayMethod = vi.fn();
    pluginEntry.register({
      pluginConfig: {
        perAgentOvBaseUrl: "http://127.0.0.1:8091",
        legacyOvBaseUrl: "http://127.0.0.1:8092",
        agentRouting: "query",
        statsLogPath: "/tmp/qm.jsonl",
        sessionFallback: { enabled: true, memoryRoot: "/tmp/ov", pythonBin: "/tmp/python" },
      },
      registerTool: vi.fn(),
      registerService: vi.fn(),
      registerGatewayMethod,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    } as never);

    const handler = registerGatewayMethod.mock.calls[0]?.[1];
    const respond = vi.fn();
    await handler({ respond });
    expect(respond).toHaveBeenCalledWith(true, {
      ok: true,
      perAgentConfigured: true,
      legacyConfigured: true,
      agentRouting: "query",
      sessionFallbackEnabled: true,
      statsLogging: true,
    });
  });
});
