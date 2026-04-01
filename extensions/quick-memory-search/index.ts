import type { OpenClawPluginApi, AnyAgentTool } from "openclaw/plugin-sdk";
import { jsonResult, readNumberParam, readStringParam } from "openclaw/plugin-sdk";
import { classifyOvFailure, type OvFailureClass, writeOvStats } from "./ov-stats.js";
import { createQuickSessionSearchTool } from "./session-search.js";

const QuickMemorySearchSchema = {
  type: "object" as const,
  properties: {
    query: { type: "string" as const, description: "Semantic search query for fast memory recall" },
    maxResults: { type: "number" as const, description: "Maximum results to return (default 5)" },
  },
  required: ["query"] as string[],
};

type Attempt = { mode: "per-agent" | "legacy"; url: string; headers: Record<string, string> };

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}

function resolveAttempts(cfg: { perAgentBaseUrl: string; legacyBaseUrl: string }, agentId: string): Attempt[] {
  const attempts: Attempt[] = [];
  if (cfg.perAgentBaseUrl) {
    attempts.push({
      mode: "per-agent",
      url: joinUrl(cfg.perAgentBaseUrl, "api/v1/search/find"),
      headers: {
        "Content-Type": "application/json",
        "x-openclaw-agent-id": agentId,
      },
    });
  }
  if (cfg.legacyBaseUrl) {
    attempts.push({
      mode: "legacy",
      url: joinUrl(cfg.legacyBaseUrl, "api/v1/search/find"),
      headers: { "Content-Type": "application/json" },
    });
  }
  return attempts;
}

function buildRows(data: unknown): any[] {
  const result = (data as { result?: unknown })?.result ?? data;
  const rows: any[] = [];
  for (const key of ["resources", "memories", "skills", "instructions"]) {
    if (Array.isArray((result as Record<string, unknown> | undefined)?.[key])) {
      rows.push(...((result as any)[key] as any[]));
    }
  }
  return rows;
}

function formatFailure(params: {
  error: string;
  fallback: string;
  failureClass?: OvFailureClass;
  status?: number;
  routing?: "per-agent" | "legacy";
}): Record<string, string> {
  const payload: Record<string, string> = { error: params.error, fallback: params.fallback };
  if (params.failureClass) payload.failureClass = params.failureClass;
  if (params.status) payload.status = String(params.status);
  if (params.routing) payload.routing = params.routing;
  return payload;
}

function createQuickMemorySearchTool(cfg: { perAgentBaseUrl: string; legacyBaseUrl: string }, agentId: string): AnyAgentTool {
  return {
    label: "Quick Memory Search",
    name: "quick_memory_search",
    description: "Fast semantic search across workspace knowledge.",
    parameters: QuickMemorySearchSchema as any,
    execute: async (_toolCallId: string, params: unknown) => {
      const query = readStringParam(params, "query", { required: true });
      const maxResults = readNumberParam(params, "maxResults") ?? 5;
      if (!query || !query.trim()) return jsonResult({ results: [], error: "query is required" });

      const normalizedQuery = query.trim();
      const startedAt = Date.now();
      const failures: Array<{ mode: "per-agent" | "legacy"; status?: number; reason: string; failureClass: OvFailureClass }> = [];

      for (const attempt of resolveAttempts(cfg, agentId)) {
        try {
          const response = await fetch(attempt.url, {
            method: "POST",
            headers: attempt.headers,
            body: JSON.stringify({ query: normalizedQuery, limit: maxResults }),
            signal: AbortSignal.timeout(10_000),
          });

          if (!response.ok) {
            const reason = await response.text().catch(() => "");
            failures.push({
              mode: attempt.mode,
              status: response.status,
              reason: reason.slice(0, 200),
              failureClass: classifyOvFailure({ status: response.status, reason }),
            });
            continue;
          }

          const data = await response.json();
          const rows = buildRows(data);
          const results = rows.slice(0, maxResults).map((item: any, idx: number) => ({
            path: item.uri ?? `result-${idx}`,
            score: typeof item.score === "number" ? Math.round(item.score * 1000) / 1000 : 0,
            snippet: item.abstract ?? item.overview ?? "(no abstract)",
            source: attempt.mode === "per-agent" ? "openviking-agent-http" : "openviking-legacy-http",
            citation: item.uri ?? "",
          }));

          await writeOvStats({
            agent: agentId,
            op: "search",
            uri: "viking://resources",
            query: normalizedQuery,
            latencyMs: Date.now() - startedAt,
            resultCount: results.length,
            hit: results.length > 0,
            mode: attempt.mode,
            layer: attempt.mode === "per-agent" ? "fast-pass" : "fast-pass-shared",
            routing: attempt.mode,
          }).catch(() => {});

          return jsonResult({ results, routing: attempt.mode, agentId });
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          failures.push({ mode: attempt.mode, reason: reason.slice(0, 200), failureClass: classifyOvFailure({ reason }) });
        }
      }

      const last = failures.at(-1);
      const routing = last?.mode ?? "per-agent";
      await writeOvStats({
        agent: agentId,
        op: "search",
        uri: "viking://resources",
        query: normalizedQuery,
        latencyMs: Date.now() - startedAt,
        resultCount: 0,
        hit: false,
        mode: routing,
        layer: routing === "legacy" ? "fast-pass-shared" : "fast-pass",
        routing,
        status: last?.status,
        failureClass: last?.failureClass ?? "backend",
        failure: last?.reason,
      }).catch(() => {});

      return jsonResult(
        formatFailure({
          error: failures.map((f) => `${f.mode}${f.status ? `(${f.status})` : ""}`).join(" | ") || "quick memory search failed",
          fallback: "Use memory_search as fallback.",
          failureClass: last?.failureClass ?? "backend",
          status: last?.status,
          routing,
        }),
      );
    },
  };
}

export default function register(api: OpenClawPluginApi) {
  const cfg = (api.pluginConfig as any) || {};
  const httpConfig = {
    perAgentBaseUrl: cfg.perAgentOvBaseUrl?.trim() || process.env.OV_PER_AGENT_HTTP_BASE?.trim() || "",
    legacyBaseUrl: cfg.ovBaseUrl?.trim() || process.env.OV_LEGACY_HTTP_BASE?.trim() || "",
  };

  api.registerTool((ctx) => createQuickMemorySearchTool(httpConfig, ctx.agentId || "main"));
  api.registerTool((ctx) => createQuickSessionSearchTool(httpConfig, ctx.agentId || "main"));
}
