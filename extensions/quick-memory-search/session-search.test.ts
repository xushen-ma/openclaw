import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQuickSessionSearchTool } from "./session-search.js";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.OPENCLAW_AGENT_ID;
  delete process.env.OV_STATS_LOG_PATH;
});

describe("quick_session_search stats logging", () => {
  it("logs session-history layer for per-agent http route", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "quick-session-stats-"));
    const statsPath = join(tmp, "ov-stats.jsonl");
    process.env.OV_STATS_LOG_PATH = statsPath;

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          result: {
            total: 1,
            resources: [
              {
                uri: "viking://resources/ben-sessions/1",
                score: 0.9,
                abstract: "session",
              },
            ],
          },
        }),
      }),
    );

    const tool = createQuickSessionSearchTool(
      {
        perAgentBaseUrl: "http://127.0.0.1:8091",
      },
      "ben",
    );

    const result = await tool.execute("call-1", { query: "session context", maxResults: 3 });
    const payload = JSON.parse(result.content[0].text);

    expect(payload.provider).toBe("openviking-sessions-agent-http");
    expect(payload.routing).toBe("per-agent");

    const lines = (await readFile(statsPath, "utf8")).trim().split("\n");
    const stat = JSON.parse(lines[0]);
    expect(stat.layer).toBe("session-history");
    expect(stat.routing).toBe("per-agent");
    expect(stat.mode).toBe("per-agent");
  });
});
