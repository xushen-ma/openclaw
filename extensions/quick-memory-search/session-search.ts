import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AnyAgentTool } from "openclaw/plugin-sdk";
import { jsonResult, readNumberParam, readStringParam } from "openclaw/plugin-sdk/memory-core";
import { classifyOvFailure, type OvFailureClass, writeOvStats } from "./ov-stats.js";

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

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}

function formatFailure(params: {
  error: string;
  fallback: string;
  failureClass?: OvFailureClass;
  routing?: "per-agent" | "local";
  mode?: "per-agent" | "local";
  status?: number;
}): Record<string, string> {
  const payload: Record<string, string> = { error: params.error, fallback: params.fallback };
  if (params.failureClass) payload.failureClass = params.failureClass;
  if (params.routing) payload.routing = params.routing;
  if (params.mode) payload.mode = params.mode;
  if (params.status) payload.status = String(params.status);
  return payload;
}

async function searchLocalStore(
  storePath: string,
  query: string,
  limit: number,
): Promise<{ total: number; items: any[]; error?: string }> {
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
        print(json.dumps({"total": total, "items": [{"uri": getattr(i,"uri",str(i)), "score": float(getattr(i,"score",0)), "abstract": getattr(i,"abstract","")} for i in items[:limit]]}))
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
    const parsed = JSON.parse(typeof stdout === "string" ? stdout : "{}") as {
      total?: number;
      items?: any[];
      error?: string;
    };
    return {
      total: parsed.total ?? 0,
      items: Array.isArray(parsed.items) ? parsed.items : [],
      error: parsed.error,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { total: 0, items: [], error: message.slice(0, 200) };
  }
}

export function createQuickSessionSearchTool(
  httpConfig: { perAgentBaseUrl: string },
  agentId: string,
): AnyAgentTool {
  return {
    label: "Quick Session Search",
    name: "quick_session_search",
    description: "Search past conversations and session history semantically.",
    parameters: QuickSessionSearchSchema as any,
    execute: async (_toolCallId: string, params: unknown) => {
      const safeParams =
        typeof params === "object" && params !== null ? (params as Record<string, unknown>) : {};
      const query = readStringParam(safeParams, "query", { required: true });
      const maxResults = readNumberParam(safeParams, "maxResults") ?? 5;
      if (!query || !query.trim()) return jsonResult({ results: [], error: "query is required" });

      const normalizedQuery = query.trim();
      const startedAt = Date.now();

      if (httpConfig.perAgentBaseUrl) {
        try {
          const response = await fetch(
            joinUrl(httpConfig.perAgentBaseUrl, "api/v1/search/session-find"),
            {
              method: "POST",
              headers: { "Content-Type": "application/json", "x-openclaw-agent-id": agentId },
              body: JSON.stringify({ query: normalizedQuery, limit: maxResults }),
              signal: AbortSignal.timeout(10_000),
            },
          );

          if (response.ok) {
            const data = await response.json();
            const result = data?.result ?? data;
            const items: any[] = [];
            for (const key of ["resources", "memories", "skills", "instructions"]) {
              if (Array.isArray(result?.[key])) items.push(...result[key]);
            }
            const results = items.slice(0, maxResults).map((item: any, idx: number) => ({
              path: item.uri ?? `session-${idx}`,
              score: typeof item.score === "number" ? Math.round(item.score * 1000) / 1000 : 0,
              snippet: item.abstract ?? "(no abstract)",
              source: "openviking-sessions-agent-http",
              citation: item.uri ?? "",
            }));

            await writeOvStats({
              agent: agentId,
              op: "session-search",
              uri: `viking://resources/${agentId}-sessions`,
              query: normalizedQuery,
              latencyMs: Date.now() - startedAt,
              resultCount: results.length,
              hit: results.length > 0,
              mode: "per-agent",
              layer: "session-history",
              routing: "per-agent",
            }).catch(() => {});

            return jsonResult({
              results,
              provider: "openviking-sessions-agent-http",
              routing: "per-agent",
              agentId,
            });
          }

          const reason = await response.text().catch(() => "");
          await writeOvStats({
            agent: agentId,
            op: "session-search",
            uri: `viking://resources/${agentId}-sessions`,
            query: normalizedQuery,
            latencyMs: Date.now() - startedAt,
            resultCount: 0,
            hit: false,
            mode: "per-agent",
            layer: "session-history",
            routing: "per-agent",
            status: response.status,
            failureClass: classifyOvFailure({ status: response.status, reason }),
            failure: reason.slice(0, 200),
          }).catch(() => {});
        } catch {
          // fallback to local
        }
      }

      const local = await searchLocalStore(
        `${OV_LOCAL_ROOT}/${agentId}-sessions`,
        normalizedQuery,
        maxResults,
      );
      if (local.error) {
        const failureClass = classifyOvFailure({ reason: local.error });
        await writeOvStats({
          agent: agentId,
          op: "session-search",
          uri: `viking://resources/${agentId}-sessions`,
          query: normalizedQuery,
          latencyMs: Date.now() - startedAt,
          resultCount: 0,
          hit: false,
          mode: "local",
          layer: "session-history",
          routing: "local",
          failureClass,
          failure: local.error.slice(0, 200),
        }).catch(() => {});
        return jsonResult(
          formatFailure({
            error: "session quick search failed",
            fallback: "Use sessions_history as fallback.",
            failureClass,
            routing: "local",
            mode: "local",
          }),
        );
      }

      const results = local.items.slice(0, maxResults).map((item: any, idx: number) => ({
        path: item.uri ?? `session-${idx}`,
        score: typeof item.score === "number" ? Math.round(item.score * 1000) / 1000 : 0,
        snippet: item.abstract ?? "(no abstract)",
        source: "openviking-sessions-local",
        citation: item.uri ?? "",
      }));

      await writeOvStats({
        agent: agentId,
        op: "session-search",
        uri: `viking://resources/${agentId}-sessions`,
        query: normalizedQuery,
        latencyMs: Date.now() - startedAt,
        resultCount: results.length,
        hit: results.length > 0,
        mode: "local",
        layer: "session-history",
        routing: "local",
      }).catch(() => {});

      return jsonResult({
        results,
        provider: "openviking-sessions-local",
        routing: "local",
        agentId,
      });
    },
  };
}
