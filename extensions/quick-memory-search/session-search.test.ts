import { afterEach, describe, expect, it, vi } from "vitest";
import { createQuickSessionSearchTool } from "./session-search.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("quick_session_search", () => {
  it("uses per-agent context for header routing", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        result: {
          total: 2,
          resources: [
            {
              uri: "viking://resources/charlie-sessions/1",
              score: 0.93,
              abstract: "session one",
            },
          ],
        },
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const tool = createQuickSessionSearchTool(
      {
        perAgentBaseUrl: "http://127.0.0.1:8091",
        legacyBaseUrl: "",
        agentRouting: "header",
      },
      "charlie",
    );
    const result = await tool.execute("call-1", { query: "handoff", maxResults: 1 });
    const firstContent = result.content[0];
    const payload =
      firstContent.type === "text" ? JSON.parse(firstContent.text) : { provider: "unexpected" };

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8091/api/v1/search/session-find",
      expect.objectContaining({
        headers: expect.objectContaining({ "x-openclaw-agent-id": "charlie" }),
      }),
    );
    expect(payload.provider).toBe("openviking-sessions-agent-http");
    expect(payload.totalHits).toBe(2);
  });
});
