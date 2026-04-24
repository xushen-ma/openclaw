import type { AnyAgentTool } from "openclaw/plugin-sdk/core";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import type { OvHttpConfig } from "./ov-http-client.js";

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
import { resolveOvRequest } from "./ov-http-client.js";
import { createQuickSessionSearchTool } from "./session-search.js";

const QuickMemorySearchSchema = {
  type: "object" as const,
  properties: {
    query: { type: "string" as const, description: "Semantic search query for fast memory recall" },
    maxResults: { type: "number" as const, description: "Maximum results to return (default 5)" },
  },
  required: ["query"] as string[],
};

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

      const requestBody = { query: query.trim(), limit: maxResults };
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
          const response = await fetch(attempt.url, attempt.init);
          if (!response.ok) {
            const text = await response.text().catch(() => "");
            errors.push(`${attempt.mode}:${response.status} ${text.slice(0, 120)}`);
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
              typeof item === "object" && item !== null ? (item as SearchResultItem) : {};
            const snippet =
              typeof searchItem.abstract === "string"
                ? searchItem.abstract
                : typeof searchItem.overview === "string"
                  ? searchItem.overview
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

          return json({
            results,
            provider: results.length > 0 ? results[0].source : "openviking",
            model: "openviking-local",
            totalHits: typeof result?.total === "number" ? result.total : items.length,
            routing: attempt.mode,
            agentId,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          errors.push(`${attempt.mode}:${message}`);
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

  api.logger.info(
    `quick_memory_search + quick_session_search registered (perAgent=${httpConfig.perAgentBaseUrl || "disabled"}, legacy=${httpConfig.legacyBaseUrl || "disabled"})`,
  );
}
