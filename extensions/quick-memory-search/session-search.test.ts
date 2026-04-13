import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQuickSessionSearchTool } from "./session-search.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete process.env.OV_STATS_LOG_PATH;
});

describe("quick session search stats logging", () => {
  it("logs session-history layer for per-agent http route", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "quick-session-stats-"));
    const statsPath = join(tmp, "ov-stats.jsonl");
    process.env.OV_STATS_LOG_PATH = statsPath;

    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        result: {
          total: 1,
          resources: [
            { uri: "viking://resources/main-sessions/mock", score: 0.75, abstract: "mock" },
          ],
        },
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const tool = createQuickSessionSearchTool(
      { perAgentBaseUrl: "http://127.0.0.1:8091", agentRouting: "header" },
      "main",
    );

    const result = await tool.execute("call-1", { query: "hello", maxResults: 3 });
    const payload = JSON.parse((result.content[0] as any).text);
    expect(payload.provider).toBe("openviking-sessions-agent-http");

    const lines = (await readFile(statsPath, "utf8")).trim().split("\n");
    expect(lines.length).toBe(1);
    const stat = JSON.parse(lines[0]);
    expect(stat.layer).toBe("session-history");
    expect(stat.routing).toBe("per-agent");
    expect(stat.op).toBe("session-search");
  });
});
