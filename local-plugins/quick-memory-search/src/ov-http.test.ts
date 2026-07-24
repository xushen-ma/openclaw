import { describe, expect, it } from "vitest";
import { DEFAULT_AGENT_HEADER, normalizeAgentId, resolveOvRequests } from "./ov-http.js";

describe("quick memory OV HTTP routing", () => {
  it("normalizes agent ids before routing", () => {
    expect(normalizeAgentId("ben")).toBe("ben");
    expect(normalizeAgentId("../ben !!")).toBe("ben");
    expect(normalizeAgentId("..")).toBe("main");
    expect(normalizeAgentId("")).toBe("main");
  });

  it("routes per-agent requests with header identity by default", () => {
    const [request] = resolveOvRequests({
      config: {
        perAgentBaseUrl: "http://127.0.0.1:8091/",
        agentRouting: "header",
        agentHeaderName: DEFAULT_AGENT_HEADER,
        requestTimeoutMs: 1000,
      },
      scope: "memory",
      agentId: "ben",
      body: { query: "notes", limit: 3 },
      includeLegacy: false,
    });

    expect(request?.url).toBe("http://127.0.0.1:8091/api/v1/search/find");
    expect(request?.init.headers).toMatchObject({ [DEFAULT_AGENT_HEADER]: "ben" });
  });

  it("keeps session search on the session endpoint for per-agent and explicit legacy routes", () => {
    const requests = resolveOvRequests({
      config: {
        perAgentBaseUrl: "http://127.0.0.1:8091",
        legacyBaseUrl: "http://127.0.0.1:8092",
        agentRouting: "path",
        agentHeaderName: DEFAULT_AGENT_HEADER,
        requestTimeoutMs: 1000,
      },
      scope: "sessions",
      agentId: "mini",
      body: { query: "route", limit: 2 },
      includeLegacy: true,
    });

    expect(requests.map((request) => request.url)).toEqual([
      "http://127.0.0.1:8091/agents/mini/api/v1/search/session-find",
      "http://127.0.0.1:8092/api/v1/search/session-find",
    ]);
  });
});
