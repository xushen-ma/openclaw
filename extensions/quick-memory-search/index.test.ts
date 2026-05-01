import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import register from "./index.js";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.OPENCLAW_AGENT_ID;
  delete process.env.OV_STATS_LOG_PATH;
  delete process.env.OV_HTTP_TIMEOUT_MS;
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
    expect(stat.status).toBe("ok");
    expect(stat.resultCount).toBe(1);
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
    expect(lines.length).toBe(2);
    const perAgentFailure = JSON.parse(lines[0]);
    expect(perAgentFailure.layer).toBe("fast-pass");
    expect(perAgentFailure.routing).toBe("per-agent");
    expect(perAgentFailure.status).toBe("error");
    const stat = JSON.parse(lines[1]);
    expect(stat.layer).toBe("fast-pass-shared");
    expect(stat.routing).toBe("legacy");
  });

  it("writes valid stats JSONL for OV errors with quotes and newlines", async () => {
    const tools: any[] = [];
    const tmp = await mkdtemp(join(tmpdir(), "quick-memory-stats-"));
    const statsPath = join(tmp, "ov-stats.jsonl");
    process.env.OV_STATS_LOG_PATH = statsPath;

    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 500,
      text: async () => 'bad "quote"\n{"nested":true}',
    }));
    vi.stubGlobal("fetch", fetchMock);

    register({
      pluginConfig: {
        perAgentOvBaseUrl: "http://127.0.0.1:8091",
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
    await quickMemoryTool.execute("call-1", { query: "hello", maxResults: 3 });

    const lines = (await readFile(statsPath, "utf8")).trim().split("\n");
    expect(lines.length).toBe(1);
    const stat = JSON.parse(lines[0]);
    expect(stat.status).toBe("error");
    expect(stat.error).toContain('bad "quote"');
    expect(stat.error).toContain('{"nested":true}');
  });

  it("maps OV result arrays when totalHits is positive", async () => {
    const tools: any[] = [];
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        totalHits: 1,
        results: [{ uri: "viking://sessions/main/one", score: 0.82, text: "session hit" }],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    register({
      pluginConfig: {
        perAgentOvBaseUrl: "http://127.0.0.1:8091",
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

    const sessionTool = tools.find((tool) => tool.name === "quick_session_search");
    const result = await sessionTool.execute("call-1", { query: "session", maxResults: 3 });
    const payload = JSON.parse(result.content[0].text);

    expect(payload.totalHits).toBe(1);
    expect(payload.results).toHaveLength(1);
    expect(payload.results[0]).toMatchObject({
      path: "viking://sessions/main/one",
      snippet: "session hit",
    });
  });

  it("truncates oversized embedding inputs before OV fetch", async () => {
    const tools: any[] = [];
    let requestBody = "";
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      requestBody = typeof init.body === "string" ? init.body : JSON.stringify(init.body ?? "");
      return {
        ok: true,
        json: async () => ({
          result: { total: 0, resources: [] },
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    register({
      pluginConfig: {
        perAgentOvBaseUrl: "http://127.0.0.1:8091",
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
    const result = await quickMemoryTool.execute("call-1", {
      query: `${"x".repeat(9000)} keep-tail`,
      maxResults: 3,
    });
    const payload = JSON.parse(result.content[0].text);
    const body = JSON.parse(requestBody);

    expect(payload.queryTruncated).toBe(true);
    expect(body.query.length).toBeLessThanOrEqual(8192);
    expect(body.query).toContain("keep-tail");
  });

  it("uses a fresh timeout signal for retry after a slow OV request", async () => {
    const tools: any[] = [];
    process.env.OV_HTTP_TIMEOUT_MS = "1";
    let secondSignalWasAborted = true;
    const fetchMock = vi
      .fn()
      .mockImplementationOnce((_url: string, init: RequestInit) => {
        const signal = init.signal as AbortSignal;
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new DOMException("timeout", "AbortError")));
        });
      })
      .mockImplementationOnce(async (_url: string, init: RequestInit) => {
        secondSignalWasAborted = (init.signal as AbortSignal).aborted;
        return {
          ok: true,
          json: async () => ({
            result: {
              total: 1,
              resources: [{ uri: "viking://resources/main/retry", score: 0.7, abstract: "retry" }],
            },
          }),
        };
      });
    vi.stubGlobal("fetch", fetchMock);

    register({
      pluginConfig: {
        perAgentOvBaseUrl: "http://127.0.0.1:8091",
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
    const result = await quickMemoryTool.execute("call-1", { query: "retry", maxResults: 3 });
    const payload = JSON.parse(result.content[0].text);

    expect(payload.results).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(secondSignalWasAborted).toBe(false);
  });
});
