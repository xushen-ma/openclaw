import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import register from "./index.js";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.OPENCLAW_AGENT_ID;
  delete process.env.OV_STATS_LOG_PATH;
});

describe("quick-memory-search plugin register", () => {
  it("registers tools, sidecar service, and status gateway method", () => {
    const registerTool = vi.fn();
    const registerService = vi.fn();
    const registerGatewayMethod = vi.fn();

    register({
      pluginConfig: {
        perAgentOvBaseUrl: "http://127.0.0.1:8091",
        ovBaseUrl: "http://127.0.0.1:8087",
      },
      resolvePath: (p: string) => `/plugin/${p}`,
      registerTool,
      registerService,
      registerGatewayMethod,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    } as never);

    expect(registerTool).toHaveBeenCalledTimes(2);
    expect(registerService).toHaveBeenCalledTimes(1);
    expect(registerGatewayMethod).toHaveBeenCalledWith(
      "quick-memory-search.status",
      expect.any(Function),
    );

    const [service] = registerService.mock.calls[0];
    expect(service.id).toBe("quick-memory-search.per-agent-sidecar");
  });

  it("quick_memory_search logs per-agent fast-pass stats", async () => {
    const tools: any[] = [];
    const tmp = await mkdtemp(join(tmpdir(), "quick-memory-stats-"));
    const statsPath = join(tmp, "ov-stats.jsonl");
    process.env.OV_STATS_LOG_PATH = statsPath;

    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        result: {
          total: 1,
          resources: [{ uri: "viking://resources/main/mock", score: 0.91, abstract: "mock" }],
        },
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    process.env.OPENCLAW_AGENT_ID = "main";

    register({
      pluginConfig: {
        perAgentOvBaseUrl: "http://127.0.0.1:8091",
        ovBaseUrl: "http://127.0.0.1:8087",
      },
      resolvePath: (p: string) => `/plugin/${p}`,
      registerTool: (toolOrFactory: any) => {
        const tool =
          typeof toolOrFactory === "function" ? toolOrFactory({ agentId: "main" }) : toolOrFactory;
        tools.push(tool);
      },
      registerService: vi.fn(),
      registerGatewayMethod: vi.fn(),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    } as never);

    const quickMemoryTool = tools.find((tool) => tool.name === "quick_memory_search");
    expect(quickMemoryTool).toBeDefined();

    const result = await quickMemoryTool.execute("call-1", { query: "hello", maxResults: 3 });
    const payload = JSON.parse(result.content[0].text);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8091/api/v1/search/find",
      expect.objectContaining({
        headers: expect.objectContaining({ "x-openclaw-agent-id": "main" }),
      }),
    );
    expect(payload.routing).toBe("per-agent");

    const lines = (await readFile(statsPath, "utf8")).trim().split("\n");
    expect(lines.length).toBe(1);
    const stat = JSON.parse(lines[0]);
    expect(stat.layer).toBe("fast-pass");
    expect(stat.routing).toBe("per-agent");
  });

  it("quick_memory_search fallback logs legacy fast-pass stats", async () => {
    const tools: any[] = [];
    const tmp = await mkdtemp(join(tmpdir(), "quick-memory-stats-"));
    const statsPath = join(tmp, "ov-stats.jsonl");
    process.env.OV_STATS_LOG_PATH = statsPath;

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503, text: async () => "unavailable" })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            total: 1,
            resources: [
              { uri: "viking://resources/main/fallback", score: 0.77, abstract: "fallback" },
            ],
          },
        }),
      });
    vi.stubGlobal("fetch", fetchMock);
    process.env.OPENCLAW_AGENT_ID = "main";

    register({
      pluginConfig: {
        perAgentOvBaseUrl: "http://127.0.0.1:8091",
        ovBaseUrl: "http://127.0.0.1:8087",
      },
      resolvePath: (p: string) => `/plugin/${p}`,
      registerTool: (toolOrFactory: any) => {
        const tool =
          typeof toolOrFactory === "function" ? toolOrFactory({ agentId: "main" }) : toolOrFactory;
        tools.push(tool);
      },
      registerService: vi.fn(),
      registerGatewayMethod: vi.fn(),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    } as never);

    const quickMemoryTool = tools.find((tool) => tool.name === "quick_memory_search");
    expect(quickMemoryTool).toBeDefined();

    const result = await quickMemoryTool.execute("call-1", { query: "fallback", maxResults: 3 });
    const payload = JSON.parse(result.content[0].text);
    expect(payload.routing).toBe("legacy");

    const lines = (await readFile(statsPath, "utf8")).trim().split("\n");
    const stat = JSON.parse(lines[0]);
    expect(stat.layer).toBe("fast-pass-shared");
    expect(stat.routing).toBe("legacy");
  });
});
