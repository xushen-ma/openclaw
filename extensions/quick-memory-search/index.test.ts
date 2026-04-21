import * as fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import register, { resolvePerAgentSidecarScriptPath } from "./index.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete process.env.OV_PER_AGENT_HTTP_BASE;
  delete process.env.OV_LEGACY_HTTP_BASE;
});

it("prefers the built .js sidecar artifact", () => {
  const tmpDir = fs.mkdtempSync("/tmp/qms-sidecar-");
  const jsPath = `${tmpDir}/per-agent-ov-http-server.js`;
  fs.writeFileSync(jsPath, "export default {}\n", "utf8");

  const scriptPath = resolvePerAgentSidecarScriptPath({
    resolvePath: (p: string) =>
      p === "./per-agent-ov-http-server.js" ? jsPath : `${tmpDir}/per-agent-ov-http-server.mjs`,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  } as never);

  expect(scriptPath).toBe(jsPath);
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

  it("falls back to .js sidecar path when .mjs artifact is absent", () => {
    const registerService = vi.fn();

    register({
      pluginConfig: {
        perAgentOvBaseUrl: "http://127.0.0.1:8091",
      },
      resolvePath: (p: string) =>
        p === "./per-agent-ov-http-server.mjs"
          ? "/missing/per-agent-ov-http-server.mjs"
          : "/present/per-agent-ov-http-server.js",
      registerTool: vi.fn(),
      registerService,
      registerGatewayMethod: vi.fn(),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    } as never);

    const [service] = registerService.mock.calls[0];
    expect(service.start).toBeTypeOf("function");
  });

  it("passes agentId from tool context into quick_memory_search", async () => {
    const tools: any[] = [];
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        result: {
          total: 1,
          resources: [{ uri: "viking://resources/ben/mock", score: 0.99, abstract: "match" }],
        },
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    register({
      pluginConfig: {
        perAgentOvBaseUrl: "http://127.0.0.1:8091",
      },
      resolvePath: (p: string) => `/plugin/${p}`,
      registerTool: (factoryOrTool: any) => {
        const tool =
          typeof factoryOrTool === "function" ? factoryOrTool({ agentId: "ben" }) : factoryOrTool;
        tools.push(tool);
      },
      registerService: vi.fn(),
      registerGatewayMethod: vi.fn(),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    } as never);

    const quickMemoryTool = tools.find((tool) => tool.name === "quick_memory_search");
    const result = await quickMemoryTool.execute("call-1", { query: "hello", maxResults: 2 });
    const payload = JSON.parse(result.content[0].text);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8091/api/v1/search/find",
      expect.objectContaining({
        headers: expect.objectContaining({ "x-openclaw-agent-id": "ben" }),
      }),
    );
    expect(payload.agentId).toBe("ben");
    expect(payload.routing).toBe("per-agent");
  });

  it("passes agentId from tool context into quick_session_search", async () => {
    const tools: any[] = [];
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        result: {
          total: 1,
          resources: [
            { uri: "viking://resources/ben-sessions/1", score: 0.9, abstract: "session" },
          ],
        },
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    register({
      pluginConfig: {
        perAgentOvBaseUrl: "http://127.0.0.1:8091",
      },
      resolvePath: (p: string) => `/plugin/${p}`,
      registerTool: (factoryOrTool: any) => {
        const tool =
          typeof factoryOrTool === "function" ? factoryOrTool({ agentId: "ben" }) : factoryOrTool;
        tools.push(tool);
      },
      registerService: vi.fn(),
      registerGatewayMethod: vi.fn(),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    } as never);

    const quickSessionTool = tools.find((tool) => tool.name === "quick_session_search");
    const result = await quickSessionTool.execute("call-1", {
      query: "session context",
      maxResults: 3,
    });
    const payload = JSON.parse(result.content[0].text);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8091/api/v1/search/session-find",
      expect.objectContaining({
        headers: expect.objectContaining({ "x-openclaw-agent-id": "ben" }),
      }),
    );
    expect(payload.provider).toBe("openviking-sessions-agent-http");
    expect(payload.agentId).toBe("ben");
  });
});
