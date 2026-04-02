import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import register from "./index.js";

function materializeTool(tools: unknown[], name: string) {
  for (const entry of tools) {
    const tool = typeof entry === "function" ? entry({ agentId: "main" }) : entry;
    if (tool?.name === name) return tool;
  }
  return undefined;
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.OPENCLAW_AGENT_ID;
  delete process.env.OV_STATS_LOG_PATH;
});

describe("quick-memory-search plugin register", () => {
  it("registers quick-memory tools", () => {
    const registerTool = vi.fn();

    register({
      pluginConfig: {
        perAgentOvBaseUrl: "http://127.0.0.1:8091",
        ovBaseUrl: "http://127.0.0.1:8087",
      },
      resolvePath: (p: string) => `/plugin/${p}`,
      registerTool,
      registerService: vi.fn(),
      registerGatewayMethod: vi.fn(),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    } as never);

    expect(registerTool).toHaveBeenCalledTimes(2);
  });

  it("quick_memory_search logs per-agent fast-pass stats", async () => {
    const tools: unknown[] = [];
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

    register({
      pluginConfig: {
        perAgentOvBaseUrl: "http://127.0.0.1:8091",
      },
      resolvePath: (p: string) => `/plugin/${p}`,
      registerTool: (toolOrFactory: unknown) => tools.push(toolOrFactory),
      registerService: vi.fn(),
      registerGatewayMethod: vi.fn(),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    } as never);

    const quickMemoryTool = materializeTool(tools, "quick_memory_search");
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
    expect(stat.failure_class).toBeUndefined();
  });

  it("classifies 429 rate-limit failures in quick-memory response payload", async () => {
    const tools: unknown[] = [];
    const tmp = await mkdtemp(join(tmpdir(), "quick-memory-stats-"));
    const statsPath = join(tmp, "ov-stats.jsonl");
    process.env.OV_STATS_LOG_PATH = statsPath;

    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 429,
      text: async () => "too many requests",
    }));
    vi.stubGlobal("fetch", fetchMock);

    register({
      pluginConfig: {
        perAgentOvBaseUrl: "http://127.0.0.1:8091",
      },
      resolvePath: (p: string) => `/plugin/${p}`,
      registerTool: (toolOrFactory: unknown) => tools.push(toolOrFactory),
      registerService: vi.fn(),
      registerGatewayMethod: vi.fn(),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    } as never);

    const quickMemoryTool = materializeTool(tools, "quick_memory_search");
    const result = await quickMemoryTool.execute("call-1", { query: "hello", maxResults: 3 });
    const payload = JSON.parse(result.content[0].text);

    expect(payload.failureClass).toBe("rate");
    expect(payload.routing).toBe("per-agent");

    const lines = (await readFile(statsPath, "utf8")).trim().split("\n");
    const stat = JSON.parse(lines[0]);
    expect(stat.failure_class).toBe("rate");
    expect(stat.status).toBe(429);
  });
});
