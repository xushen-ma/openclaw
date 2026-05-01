import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { AnyAgentTool, OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import {
  fetchOvRequest,
  normalizeOvSearchResult,
  resolveOvRequest,
  truncateEmbeddingInput,
  type OvHttpConfig,
} from "./ov-http-client.js";
import { createQuickSessionSearchTool } from "./session-search.js";

type PluginConfig = {
  perAgentOvBaseUrl?: unknown;
  ovBaseUrl?: unknown;
  agentRouting?: unknown;
  agentHeaderName?: unknown;
};

function resolveAgentRouting(value: unknown): OvHttpConfig["agentRouting"] {
  return value === "header" || value === "path" || value === "query" ? value : "header";
}

type SearchResultItem = {
  uri?: unknown;
  score?: unknown;
  abstract?: unknown;
  overview?: unknown;
  text?: unknown;
  content?: unknown;
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

const QuickMemorySearchSchema = {
  type: "object" as const,
  properties: {
    query: { type: "string" as const, description: "Semantic search query for fast memory recall" },
    maxResults: { type: "number" as const, description: "Maximum results to return (default 5)" },
  },
  required: ["query"] as string[],
};

async function appendOvFastPassStat(entry: {
  layer: "fast-pass" | "fast-pass-shared";
  routing: "per-agent" | "legacy";
  agentId: string;
  query: string;
  maxResults: number;
  totalHits: number;
  resultCount: number;
  status: "ok" | "error";
  error?: string;
  queryTruncated?: boolean;
}) {
  const statsPath = process.env.OV_STATS_LOG_PATH?.trim();
  if (!statsPath) {
    return;
  }
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry });
  try {
    await mkdir(dirname(statsPath), { recursive: true });
    await appendFile(statsPath, `${line}\n`, "utf8");
  } catch {
    // best-effort diagnostics only
  }
}

function createQuickMemorySearchTool(httpConfig: OvHttpConfig, agentId: string): AnyAgentTool {
  return {
    label: "Quick Memory Search",
    name: "quick_memory_search",
    description:
      "Fast semantic search across workspace knowledge. Use as FIRST-choice recall tool. " +
      "Primary path is per-agent OV HTTP (aligned with per-agent memory stores); " +
      "legacy shared OV HTTP is optional transitional fallback.",
    parameters: QuickMemorySearchSchema as unknown as Record<string, unknown>,
    execute: async (_toolCallId: string, params: unknown) => {
      const query = str(params, "query");
      const maxResults = num(params, "maxResults") ?? 5;
      if (!query || !query.trim()) {
        return json({ results: [], error: "query is required" });
      }

      const safeQuery = truncateEmbeddingInput(query);
      const requestBody = { query: safeQuery.text, limit: maxResults };
      const attempts = resolveOvRequest({
        config: httpConfig,
        scope: "memory",
        agentId,
        body: requestBody,
      });

      if (attempts.length === 0) {
        return json({
          results: [],
          error: "No OV HTTP endpoint configured (per-agent or legacy)",
          fallback: "Use memory_search as fallback.",
        });
      }

      const errors: string[] = [];
      for (const attempt of attempts) {
        try {
          const response = await fetchOvRequest(attempt);
          if (!response.ok) {
            const text = await response.text().catch(() => "");
            const error = `${response.status} ${text.slice(0, 120)}`;
            errors.push(`${attempt.mode}:${error}`);
            await appendOvFastPassStat({
              layer: attempt.mode === "per-agent" ? "fast-pass" : "fast-pass-shared",
              routing: attempt.mode,
              agentId,
              query: safeQuery.text,
              maxResults,
              totalHits: 0,
              resultCount: 0,
              status: "error",
              error,
              queryTruncated: safeQuery.truncated,
            });
            continue;
          }

          const data = await response.json();
          const { items, totalHits } = normalizeOvSearchResult(data);

          const results = items.slice(0, maxResults).map((item: unknown, idx: number) => {
            const searchItem =
              typeof item === "object" && item !== null ? (item as SearchResultItem) : {};
            const snippet =
              typeof searchItem.abstract === "string"
                ? searchItem.abstract
                : typeof searchItem.overview === "string"
                  ? searchItem.overview
                  : typeof searchItem.text === "string"
                    ? searchItem.text
                    : typeof searchItem.content === "string"
                      ? searchItem.content
                  : "(no abstract)";
            const score =
              typeof searchItem.score === "number" ? Math.round(searchItem.score * 1000) / 1000 : 0;
            return {
              path: searchItem.uri ?? `result-${idx}`,
              score,
              snippet,
              source:
                attempt.mode === "per-agent" ? "openviking-agent-http" : "openviking-legacy-http",
              citation: searchItem.uri ?? "",
            };
          });

          await appendOvFastPassStat({
            layer: attempt.mode === "per-agent" ? "fast-pass" : "fast-pass-shared",
            routing: attempt.mode,
            agentId,
            query: safeQuery.text,
            maxResults,
            totalHits,
            resultCount: results.length,
            status: "ok",
            queryTruncated: safeQuery.truncated,
          });

          return json({
            results,
            provider: results.length > 0 ? results[0].source : "openviking",
            model: "openviking-local",
            totalHits,
            routing: attempt.mode,
            agentId,
            queryTruncated: safeQuery.truncated,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          errors.push(`${attempt.mode}:${message}`);
          await appendOvFastPassStat({
            layer: attempt.mode === "per-agent" ? "fast-pass" : "fast-pass-shared",
            routing: attempt.mode,
            agentId,
            query: safeQuery.text,
            maxResults,
            totalHits: 0,
            resultCount: 0,
            status: "error",
            error: message,
            queryTruncated: safeQuery.truncated,
          });
        }
      }

      return json({
        results: [],
        error: errors.join(" | "),
        fallback: "Use memory_search as fallback.",
      });
    },
  };
}

export default function register(api: OpenClawPluginApi) {
  const cfg =
    typeof api.pluginConfig === "object" && api.pluginConfig !== null
      ? (api.pluginConfig as PluginConfig)
      : {};
  const httpConfig: OvHttpConfig = {
    perAgentBaseUrl:
      (typeof cfg.perAgentOvBaseUrl === "string" ? cfg.perAgentOvBaseUrl.trim() : "") ||
      process.env.OV_PER_AGENT_HTTP_BASE?.trim() ||
      "",
    legacyBaseUrl:
      (typeof cfg.ovBaseUrl === "string" ? cfg.ovBaseUrl.trim() : "") ||
      process.env.OV_LEGACY_HTTP_BASE?.trim() ||
      "",
    agentRouting: resolveAgentRouting(cfg.agentRouting),
    agentHeaderName: typeof cfg.agentHeaderName === "string" ? cfg.agentHeaderName : undefined,
  };

  // Use factory pattern so each agent's tool instance captures the correct agentId
  // at registration time rather than reading process.env.OPENCLAW_AGENT_ID (never set).
  api.registerTool((ctx) => createQuickMemorySearchTool(httpConfig, ctx.agentId || "main"));
  api.registerTool((ctx) => createQuickSessionSearchTool(httpConfig, ctx.agentId || "main"));

  api.registerService({
    id: "quick-memory-search.per-agent-sidecar",
    start: () => {
      api.logger.info("quick-memory-search sidecar service ready");
    },
    stop: () => {},
  });

  api.registerGatewayMethod("quick-memory-search.status", async ({ respond }) => {
    respond(true, {
      ok: true,
      perAgentBaseUrl: httpConfig.perAgentBaseUrl || null,
      legacyBaseUrl: httpConfig.legacyBaseUrl || null,
      agentRouting: httpConfig.agentRouting,
    });
  });

  api.logger.info(
    `quick_memory_search + quick_session_search registered (perAgent=${httpConfig.perAgentBaseUrl || "disabled"}, legacy=${httpConfig.legacyBaseUrl || "disabled"})`,
  );
}
