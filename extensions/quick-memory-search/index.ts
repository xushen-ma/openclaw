import type { OpenClawPluginApi, AnyAgentTool } from "openclaw/plugin-sdk";

function json(payload: unknown): any {
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], details: payload };
}
function str(params: unknown, key: string): string | undefined {
  return typeof (params as any)?.[key] === "string" ? (params as any)[key].trim() : undefined;
}
function num(params: unknown, key: string): number | undefined {
  const v = (params as any)?.[key];
  return typeof v === "number" ? v : undefined;
}
import { resolveOvRequest, type OvHttpConfig } from "./ov-http-client.js";
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
    parameters: QuickMemorySearchSchema as any,
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
          const items: any[] = [];
          for (const key of ["resources", "memories", "skills", "instructions"]) {
            if (Array.isArray(result?.[key])) items.push(...result[key]);
          }

          const results = items.slice(0, maxResults).map((item: any, idx: number) => ({
            path: item.uri ?? `result-${idx}`,
            score: typeof item.score === "number" ? Math.round(item.score * 1000) / 1000 : 0,
            snippet: item.abstract ?? item.overview ?? "(no abstract)",
            source:
              attempt.mode === "per-agent" ? "openviking-agent-http" : "openviking-legacy-http",
            citation: item.uri ?? "",
          }));

          return json({
            results,
            provider: results.length > 0 ? results[0].source : "openviking",
            model: "openviking-local",
            totalHits: result?.total ?? items.length,
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
  const cfg = (api.pluginConfig as any) || {};
  const httpConfig: OvHttpConfig = {
    perAgentBaseUrl:
      cfg.perAgentOvBaseUrl?.trim() || process.env.OV_PER_AGENT_HTTP_BASE?.trim() || "",
    legacyBaseUrl: cfg.ovBaseUrl?.trim() || process.env.OV_LEGACY_HTTP_BASE?.trim() || "",
    agentRouting: cfg.agentRouting || "header",
    agentHeaderName: cfg.agentHeaderName,
  };

  // Use factory pattern so each agent's tool instance captures the correct agentId
  // at registration time rather than reading process.env.OPENCLAW_AGENT_ID (never set).
  api.registerTool((ctx) => createQuickMemorySearchTool(httpConfig, ctx.agentId || "main"));
  api.registerTool((ctx) => createQuickSessionSearchTool(httpConfig, ctx.agentId || "main"));

  api.logger.info(
    `quick_memory_search + quick_session_search registered (perAgent=${httpConfig.perAgentBaseUrl || "disabled"}, legacy=${httpConfig.legacyBaseUrl || "disabled"})`,
  );
}
