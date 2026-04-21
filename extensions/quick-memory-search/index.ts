import fs from "node:fs";
import type { OpenClawPluginApi, AnyAgentTool } from "openclaw/plugin-sdk";
import { jsonResult, readStringParam, readNumberParam } from "openclaw/plugin-sdk/channel-actions";
import { isRecord, normalizeOptionalString } from "openclaw/plugin-sdk/text-runtime";
import { resolveOvRequest, type OvHttpConfig } from "./ov-http-client.js";
import { createQuickMemoryPerAgentSidecarService } from "./per-agent-sidecar-service.js";
import { createQuickSessionSearchTool } from "./session-search.js";

type QuickMemoryItem = {
  uri?: string;
  score?: number;
  abstract?: string;
  overview?: string;
};

type QuickMemoryResultEnvelope = {
  result?: QuickMemoryResultPayload;
  total?: number;
};

type QuickMemoryResultPayload = {
  resources?: QuickMemoryItem[];
  memories?: QuickMemoryItem[];
  skills?: QuickMemoryItem[];
  instructions?: QuickMemoryItem[];
  total?: number;
};

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
    parameters: QuickMemorySearchSchema as unknown as AnyAgentTool["parameters"],
    execute: async (_toolCallId: string, params: unknown) => {
      const safeParams = isRecord(params) ? params : {};
      const query = readStringParam(safeParams, "query", { required: true });
      const maxResults = readNumberParam(safeParams, "maxResults") ?? 5;
      if (!query || !query.trim()) {
        return jsonResult({ results: [], error: "query is required" });
      }

      const normalizedQuery = query.trim();
      const requestBody = { query: normalizedQuery, limit: maxResults };
      const attempts = resolveOvRequest({
        config: httpConfig,
        scope: "memory",
        agentId,
        body: requestBody,
      });

      if (attempts.length === 0) {
        return jsonResult({
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

          const data = (await response.json()) as QuickMemoryResultEnvelope;
          const result: QuickMemoryResultPayload = data.result ?? {};
          const items: QuickMemoryItem[] = [];
          const candidateBuckets = [
            result.resources,
            result.memories,
            result.skills,
            result.instructions,
          ];
          for (const bucket of candidateBuckets) {
            if (Array.isArray(bucket)) {
              items.push(...bucket);
            }
          }

          const results = items.slice(0, maxResults).map((item: QuickMemoryItem, idx: number) => ({
            path: item.uri ?? `result-${idx}`,
            score: typeof item.score === "number" ? Math.round(item.score * 1000) / 1000 : 0,
            snippet: item.abstract ?? item.overview ?? "(no abstract)",
            source:
              attempt.mode === "per-agent" ? "openviking-agent-http" : "openviking-legacy-http",
            citation: item.uri ?? "",
          }));

          return jsonResult({
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

      return jsonResult({
        results: [],
        error: errors.join(" | "),
        fallback: "Use memory_search as fallback.",
      });
    },
  };
}

export default function register(api: OpenClawPluginApi) {
  const cfg = isRecord(api.pluginConfig) ? api.pluginConfig : {};
  const agentRouting = isAgentRouting(cfg.agentRouting) ? cfg.agentRouting : "header";
  const httpConfig: OvHttpConfig = {
    perAgentBaseUrl:
      normalizeOptionalString(cfg.perAgentOvBaseUrl) ||
      process.env.OV_PER_AGENT_HTTP_BASE?.trim() ||
      "",
    legacyBaseUrl:
      normalizeOptionalString(cfg.ovBaseUrl) || process.env.OV_LEGACY_HTTP_BASE?.trim() || "",
    agentRouting,
    agentHeaderName: normalizeOptionalString(cfg.agentHeaderName),
  };

  api.registerTool((ctx) => createQuickMemorySearchTool(httpConfig, ctx.agentId || "main"));
  api.registerTool((ctx) => createQuickSessionSearchTool(httpConfig, ctx.agentId || "main"));

  const sidecar = createQuickMemoryPerAgentSidecarService({
    perAgentBaseUrl: httpConfig.perAgentBaseUrl ?? "",
    scriptPath: resolvePerAgentSidecarScriptPath(api),
    logger: api.logger,
  });
  api.registerService(sidecar.service);
  api.registerGatewayMethod("quick-memory-search.status", ({ respond }) => {
    respond(true, sidecar.status());
  });

  api.logger.info(
    `quick_memory_search + quick_session_search registered (perAgent=${httpConfig.perAgentBaseUrl || "disabled"}, legacy=${httpConfig.legacyBaseUrl || "disabled"})`,
  );
}

function isAgentRouting(value: unknown): value is OvHttpConfig["agentRouting"] {
  return value === "header" || value === "path" || value === "query";
}

function resolvePerAgentSidecarScriptPath(api: Pick<OpenClawPluginApi, "resolvePath" | "logger">) {
  const candidates = [
    api.resolvePath("./per-agent-ov-http-server.mjs"),
    api.resolvePath("./per-agent-ov-http-server.js"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  api.logger.warn?.(
    "quick-memory-search: sidecar script not found via built artifact probing; defaulting to .mjs path",
  );
  return candidates[0];
}
