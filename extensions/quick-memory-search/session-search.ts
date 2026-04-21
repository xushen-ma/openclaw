import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AnyAgentTool } from "openclaw/plugin-sdk";
import { jsonResult, readStringParam, readNumberParam } from "openclaw/plugin-sdk/channel-actions";
import { isRecord } from "openclaw/plugin-sdk/text-runtime";
import { resolveOvRequest, type OvHttpConfig } from "./ov-http-client.js";

type QuickSessionItem = {
  uri?: string;
  score?: number;
  abstract?: string;
};

type QuickSessionStoreResult = {
  total: number;
  items: QuickSessionItem[];
  error?: string;
};

type QuickSessionHttpEnvelope = {
  result?: Record<string, unknown> & { total?: number };
  total?: number;
};

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
): Promise<QuickSessionStoreResult> {
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
    return JSON.parse(stdout.trim());
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
    parameters: QuickSessionSearchSchema as unknown as AnyAgentTool["parameters"],
    execute: async (_toolCallId: string, params: unknown, _signal?: AbortSignal) => {
      const safeParams = isRecord(params) ? params : {};
      const query = readStringParam(safeParams, "query", { required: true });
      const maxResults = readNumberParam(safeParams, "maxResults") ?? 5;

      if (!query || !query.trim()) {
        return jsonResult({ results: [], error: "query is required" });
      }

      const normalizedQuery = query.trim();

      // HTTP first (per-agent). If unavailable/failing, fallback to local store.
      const httpAttempts = resolveOvRequest({
        config: httpConfig,
        scope: "sessions",
        agentId,
        body: { query: normalizedQuery, limit: maxResults },
      }).filter((x) => x.mode === "per-agent");

      for (const attempt of httpAttempts) {
        try {
          const response = await fetch(attempt.url, attempt.init);
          if (!response.ok) {
            continue;
          }
          const data = (await response.json()) as QuickSessionHttpEnvelope;
          const result = (data.result ?? data) as Record<string, unknown> & { total?: number };
          const items: QuickSessionItem[] = [];
          for (const key of ["resources", "memories", "skills", "instructions"]) {
            const bucket = result[key];
            if (Array.isArray(bucket)) {
              items.push(...(bucket as QuickSessionItem[]));
            }
          }

          const results = items.slice(0, maxResults).map((item: QuickSessionItem, idx: number) => ({
            path: item.uri ?? `session-${idx}`,
            score: typeof item.score === "number" ? Math.round(item.score * 1000) / 1000 : 0,
            snippet: item.abstract ?? "(no abstract)",
            source: "openviking-sessions-agent-http",
            citation: item.uri ?? "",
          }));

          return jsonResult({
            results,
            provider: "openviking-sessions-agent-http",
            agentId,
            totalHits: result?.total ?? results.length,
          });
        } catch {
          // continue to local fallback
        }
      }

      const sessionStorePath = `${OV_LOCAL_ROOT}/${agentId}-sessions`;
      try {
        const data = await searchLocalStore(sessionStorePath, normalizedQuery, maxResults);

        if (data.error) {
          return jsonResult({
            results: [],
            error: data.error,
            fallback: "Use sessions_history as fallback.",
          });
        }

        const results = (data.items || []).map((item: QuickSessionItem, idx: number) => ({
          path: item.uri ?? `session-${idx}`,
          score: typeof item.score === "number" ? Math.round(item.score * 1000) / 1000 : 0,
          snippet: item.abstract ?? "(no abstract)",
          source: "openviking-sessions-local",
          citation: item.uri ?? "",
        }));

        return jsonResult({
          results,
          provider: "openviking-sessions-local",
          agentId,
          totalHits: data.total ?? results.length,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return jsonResult({
          results: [],
          error: message,
          fallback: "Use sessions_history as fallback.",
        });
      }
    },
  };
}
