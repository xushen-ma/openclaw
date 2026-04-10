import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AnyAgentTool } from "openclaw/plugin-sdk";

type SearchResponse = {
  total?: unknown;
  items?: unknown;
  error?: unknown;
};

type SearchItem = {
  uri?: unknown;
  score?: unknown;
  abstract?: unknown;
};

function json(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    details: payload,
  };
}
function str(params: unknown, key: string): string | undefined {
  if (typeof params !== "object" || params === null) {
    return undefined;
  }
  const value = (params as Record<string, unknown>)[key];
  return typeof value === "string" ? value.trim() : undefined;
}
function num(params: unknown, key: string): number | undefined {
  if (typeof params !== "object" || params === null) {
    return undefined;
  }
  const v = (params as Record<string, unknown>)[key];
  return typeof v === "number" ? v : undefined;
}
import { resolveOvRequest, type OvHttpConfig } from "./ov-http-client.js";

const execFileAsync = promisify(execFile);

const QuickSessionSearchSchema = {
  type: "object" as const,
  properties: {
    query: {
      type: "string" as const,
      description: "Search query for past session/conversation recall",
    },
    maxResults: { type: "number" as const, description: "Maximum results to return (default 5)" },
  },
  required: ["query"] as string[],
};

const OV_LOCAL_ROOT = process.env.OV_DATA_ROOT || "/Users/openclaw/.openclaw/memory/openviking";
const VENV_PY =
  "/Users/openclaw/.openclaw/workspace/projects/openviking-migration/tmp/openviking-venv/bin/python";

async function searchLocalStore(
  storePath: string,
  query: string,
  limit: number,
): Promise<{ total: number; items: unknown[]; error?: string }> {
  const script = `
import sys, json, time
import openviking

store, query, limit = sys.argv[1], sys.argv[2], int(sys.argv[3])
MAX_RETRIES = 3
BACKOFF = [0.5, 1.0, 2.0]

for attempt in range(MAX_RETRIES + 1):
    try:
        c = openviking.SyncOpenViking(path=store)
        c.initialize()
        res = c.search(query=query, target_uri="viking://resources", limit=limit)
        total = getattr(res, "total", 0)
        items = []
        for key in ("resources", "memories", "skills"):
            items.extend(getattr(res, key, []) or [])
        print(json.dumps({
            "total": total,
            "items": [{"uri": getattr(i,"uri",str(i)), "score": float(getattr(i,"score",0)), "abstract": getattr(i,"abstract","")} for i in items[:limit]]
        }))
        try: c.close()
        except: pass
        break
    except Exception as e:
        try: c.close()
        except: pass
        if "lock" in str(e).lower() and attempt < MAX_RETRIES:
            time.sleep(BACKOFF[attempt])
            continue
        print(json.dumps({"total": 0, "items": [], "error": str(e)[:200]}))
        break
`;

  try {
    const { stdout } = await execFileAsync(
      VENV_PY,
      ["-c", script, storePath, query, String(limit)],
      {
        timeout: 15_000,
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
      },
    );
    const parsed = JSON.parse(stdout.trim()) as SearchResponse;
    return {
      total: typeof parsed.total === "number" ? parsed.total : 0,
      items: Array.isArray(parsed.items) ? parsed.items : [],
      ...(typeof parsed.error === "string" ? { error: parsed.error } : {}),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { total: 0, items: [], error: message.slice(0, 200) };
  }
}

export function createQuickSessionSearchTool(
  httpConfig: OvHttpConfig,
  agentId: string,
): AnyAgentTool {
  return {
    label: "Quick Session Search",
    name: "quick_session_search",
    description:
      "Search your past conversations and session history semantically. " +
      "Uses per-agent OV HTTP when configured, with local per-agent session-store fallback.",
    parameters: QuickSessionSearchSchema as unknown as Record<string, unknown>,
    execute: async (_toolCallId: string, params: unknown, _signal?: AbortSignal) => {
      const query = str(params, "query");
      const maxResults = num(params, "maxResults") ?? 5;
      if (!query || !query.trim()) {
        return json({ results: [], error: "query is required" });
      }

      // HTTP first (per-agent). If unavailable/failing, fallback to local store.
      const httpAttempts = resolveOvRequest({
        config: httpConfig,
        scope: "sessions",
        agentId,
        body: { query: query.trim(), limit: maxResults },
      }).filter((x) => x.mode === "per-agent");

      for (const attempt of httpAttempts) {
        try {
          const response = await fetch(attempt.url, attempt.init);
          if (!response.ok) {
            continue;
          }
          const data = await response.json();
          const result = data?.result ?? data;
          const items: unknown[] = [];
          for (const key of ["resources", "memories", "skills", "instructions"]) {
            if (Array.isArray(result?.[key])) {
              items.push(...(result?.[key] || []));
            }
          }

          const results = items.slice(0, maxResults).map((item: unknown, idx: number) => {
            const searchItem =
              typeof item === "object" && item !== null ? (item as SearchItem) : {};
            return {
              path: searchItem.uri ?? `session-${idx}`,
              score:
                typeof searchItem.score === "number"
                  ? Math.round(searchItem.score * 1000) / 1000
                  : 0,
              snippet:
                typeof searchItem.abstract === "string" ? searchItem.abstract : "(no abstract)",
              source: "openviking-sessions-agent-http",
              citation: searchItem.uri ?? "",
            };
          });

          return json({
            results,
            provider: "openviking-sessions-agent-http",
            agentId,
            totalHits: typeof result?.total === "number" ? result.total : results.length,
          });
        } catch {
          // continue to local fallback
        }
      }

      const sessionStorePath = `${OV_LOCAL_ROOT}/${agentId}-sessions`;
      try {
        const data = await searchLocalStore(sessionStorePath, query.trim(), maxResults);

        if (data.error) {
          return json({
            results: [],
            error: data.error,
            fallback: "Use sessions_history as fallback.",
          });
        }

        const results = data.items.map((item: unknown, idx: number) => {
          const searchItem = typeof item === "object" && item !== null ? (item as SearchItem) : {};
          return {
            path: searchItem.uri ?? `session-${idx}`,
            score:
              typeof searchItem.score === "number" ? Math.round(searchItem.score * 1000) / 1000 : 0,
            snippet:
              typeof searchItem.abstract === "string" ? searchItem.abstract : "(no abstract)",
            source: "openviking-sessions-local",
            citation: searchItem.uri ?? "",
          };
        });

        return json({
          results,
          provider: "openviking-sessions-local",
          agentId,
          totalHits: data.total ?? results.length,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return json({
          results: [],
          error: message,
          fallback: "Use sessions_history as fallback.",
        });
      }
    },
  };
}
