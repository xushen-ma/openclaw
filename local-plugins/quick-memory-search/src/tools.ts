import type { AnyAgentTool } from "openclaw/plugin-sdk/plugin-entry";
import type { TSchema } from "typebox";
import {
  normalizeOpenVikingPayload,
  normalizeAgentId,
  resolveOvRequests,
  type OvHttpConfig,
} from "./ov-http.js";
import { jsonToolResult, readPositiveInteger, readString, roundScore } from "./result.js";
import {
  resolveSessionStorePath,
  runOpenVikingSessionSearch,
  type RunOpenVikingSessionSearch,
  type SessionFallbackConfig,
} from "./session-store.js";
import { appendQuickMemoryStat } from "./stats.js";

const QuickMemorySearchSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    query: { type: "string", description: "Semantic search query for fast memory recall." },
    maxResults: { type: "integer", minimum: 1, description: "Maximum results to return." },
  },
  required: ["query"],
} as const satisfies TSchema;

const QuickSessionSearchSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    query: { type: "string", description: "Semantic search query for past session recall." },
    maxResults: { type: "integer", minimum: 1, description: "Maximum results to return." },
  },
  required: ["query"],
} as const satisfies TSchema;

function toToolResults(params: {
  items: ReturnType<typeof normalizeOpenVikingPayload>["items"];
  maxResults: number;
  source: string;
  fallbackPrefix: string;
}) {
  return params.items.slice(0, params.maxResults).map((item, index) => ({
    path: readString(item.uri) ?? `${params.fallbackPrefix}-${index}`,
    score: roundScore(item.score),
    snippet: readString(item.abstract) ?? readString(item.overview) ?? "(no abstract)",
    source: params.source,
    citation: readString(item.uri) ?? "",
  }));
}

async function fetchOpenViking(attempt: ReturnType<typeof resolveOvRequests>[number]) {
  const response = await fetch(attempt.url, attempt.init);
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`${attempt.mode}:${response.status} ${body.slice(0, 120)}`);
  }
  return normalizeOpenVikingPayload(await response.json());
}

export function createQuickMemorySearchTool(params: {
  httpConfig: OvHttpConfig;
  agentId: string;
  statsLogPath?: string;
}): AnyAgentTool {
  const agentId = normalizeAgentId(params.agentId);
  return {
    label: "Quick Memory Search",
    name: "quick_memory_search",
    description:
      "Fast semantic search across workspace knowledge. Use as the first-choice recall tool when available; falls back to memory_search if this returns unavailable.",
    parameters: QuickMemorySearchSchema,
    execute: async (_toolCallId, rawParams) => {
      const query = readString((rawParams as { query?: unknown })?.query);
      const maxResults = readPositiveInteger(
        (rawParams as { maxResults?: unknown })?.maxResults,
        5,
      );
      if (!query) {
        return jsonToolResult({ results: [], error: "query is required" });
      }
      const attempts = resolveOvRequests({
        config: params.httpConfig,
        scope: "memory",
        agentId,
        body: { query, limit: maxResults },
        includeLegacy: true,
      });
      if (attempts.length === 0) {
        return jsonToolResult({
          results: [],
          unavailable: true,
          error: "No per-agent or explicitly configured legacy OpenViking endpoint.",
          fallback: "Use memory_search as fallback.",
        });
      }
      const errors: string[] = [];
      for (const attempt of attempts) {
        try {
          const payload = await fetchOpenViking(attempt);
          const source =
            attempt.mode === "per-agent" ? "openviking-agent-http" : "openviking-legacy-http";
          const results = toToolResults({
            items: payload.items,
            maxResults,
            source,
            fallbackPrefix: "result",
          });
          await appendQuickMemoryStat(params.statsLogPath, {
            layer: attempt.mode === "per-agent" ? "fast-pass" : "fast-pass-shared",
            routing: attempt.mode,
            agentId,
            query,
            maxResults,
            totalHits: payload.total,
            resultCount: results.length,
          });
          return jsonToolResult({
            results,
            provider: source,
            model: "openviking-local",
            totalHits: payload.total,
            routing: attempt.mode,
            agentId,
          });
        } catch (err) {
          errors.push(err instanceof Error ? err.message : String(err));
        }
      }
      return jsonToolResult({
        results: [],
        error: errors.join(" | "),
        fallback: "Use memory_search as fallback.",
      });
    },
  };
}

export function createQuickSessionSearchTool(params: {
  httpConfig: OvHttpConfig;
  agentId: string;
  sessionFallback: SessionFallbackConfig;
  statsLogPath?: string;
  runLocalSearch?: RunOpenVikingSessionSearch;
}): AnyAgentTool {
  const agentId = normalizeAgentId(params.agentId);
  const runLocalSearch = params.runLocalSearch ?? runOpenVikingSessionSearch;
  return {
    label: "Quick Session Search",
    name: "quick_session_search",
    description:
      "Fast semantic search across this agent's past sessions. Uses per-agent OpenViking HTTP first, with local OpenViking fallback only when explicitly enabled.",
    parameters: QuickSessionSearchSchema,
    execute: async (_toolCallId, rawParams) => {
      const query = readString((rawParams as { query?: unknown })?.query);
      const maxResults = readPositiveInteger(
        (rawParams as { maxResults?: unknown })?.maxResults,
        5,
      );
      if (!query) {
        return jsonToolResult({ results: [], error: "query is required" });
      }
      const attempts = resolveOvRequests({
        config: params.httpConfig,
        scope: "sessions",
        agentId,
        body: { query, limit: maxResults },
        includeLegacy: false,
      });
      const errors: string[] = [];
      for (const attempt of attempts) {
        try {
          const payload = await fetchOpenViking(attempt);
          const results = toToolResults({
            items: payload.items,
            maxResults,
            source: "openviking-sessions-agent-http",
            fallbackPrefix: "session",
          });
          await appendQuickMemoryStat(params.statsLogPath, {
            layer: "session-fast-pass",
            routing: "per-agent",
            agentId,
            query,
            maxResults,
            totalHits: payload.total,
            resultCount: results.length,
          });
          return jsonToolResult({
            results,
            provider: "openviking-sessions-agent-http",
            agentId,
            totalHits: payload.total,
            routing: "per-agent",
          });
        } catch (err) {
          errors.push(err instanceof Error ? err.message : String(err));
        }
      }
      if (!params.sessionFallback.enabled) {
        return jsonToolResult({
          results: [],
          unavailable: true,
          error: errors.length ? errors.join(" | ") : "No per-agent session endpoint configured.",
          fallback: "Use sessions_history as fallback.",
        });
      }
      if (!params.sessionFallback.memoryRoot || !params.sessionFallback.pythonBin) {
        return jsonToolResult({
          results: [],
          error: "sessionFallback.enabled requires memoryRoot and pythonBin.",
          fallback: "Use sessions_history as fallback.",
        });
      }
      const storePath = resolveSessionStorePath({
        memoryRoot: params.sessionFallback.memoryRoot,
        agentId,
      });
      const local = await runLocalSearch({
        storePath,
        query,
        limit: maxResults,
        pythonBin: params.sessionFallback.pythonBin,
        timeoutMs: params.sessionFallback.timeoutMs,
      });
      if (local.error) {
        return jsonToolResult({
          results: [],
          error: local.error,
          fallback: "Use sessions_history as fallback.",
        });
      }
      const results = toToolResults({
        items: local.items,
        maxResults,
        source: "openviking-sessions-local",
        fallbackPrefix: "session",
      });
      await appendQuickMemoryStat(params.statsLogPath, {
        layer: "session-local",
        routing: "local",
        agentId,
        query,
        maxResults,
        totalHits: local.total,
        resultCount: results.length,
      });
      return jsonToolResult({
        results,
        provider: "openviking-sessions-local",
        agentId,
        totalHits: local.total,
        routing: "local",
      });
    },
  };
}
