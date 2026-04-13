import { classifyOvFailure, writeOvStats, type OvStatsLayer } from "./ov-stats.js";

export type OvSearchScope = "memory" | "sessions";

export type OvHttpConfig = {
  // Preferred per-agent HTTP endpoint, e.g. http://127.0.0.1:8091/api/v1
  perAgentBaseUrl?: string;
  // Optional legacy shared OV endpoint (transitional fallback only)
  legacyBaseUrl?: string;
  // How to pass agent id to per-agent endpoint
  agentRouting?: "path" | "query" | "header";
  // Header name used when agentRouting=header
  agentHeaderName?: string;
};

export type ResolvedRequest = {
  url: string;
  init: RequestInit;
  mode: "per-agent" | "legacy";
};

export type LoggedOvHttpResult = {
  ok: boolean;
  status?: number;
  data?: any;
  text?: string;
  error?: string;
  mode: "per-agent" | "legacy";
};

const DEFAULT_AGENT_HEADER = "x-openclaw-agent-id";

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}

function buildPerAgentUrl(
  baseUrl: string,
  scope: OvSearchScope,
  agentId: string,
  routing: OvHttpConfig["agentRouting"],
): string {
  const base = baseUrl.replace(/\/$/, "");
  if (routing === "query") {
    const endpoint = scope === "memory" ? "api/v1/search/find" : "api/v1/search/session-find";
    return `${joinUrl(base, endpoint)}?agentId=${encodeURIComponent(agentId)}`;
  }
  if (routing === "path") {
    const endpoint = scope === "memory" ? "api/v1/search/find" : "api/v1/search/session-find";
    return joinUrl(base, `agents/${encodeURIComponent(agentId)}/${endpoint}`);
  }
  // header
  const endpoint = scope === "memory" ? "api/v1/search/find" : "api/v1/search/session-find";
  return joinUrl(base, endpoint);
}

export function resolveOvRequest(opts: {
  config: OvHttpConfig;
  scope: OvSearchScope;
  agentId: string;
  body: unknown;
}): ResolvedRequest[] {
  const { config, scope, agentId, body } = opts;
  const routing = config.agentRouting ?? "header";
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  const requests: ResolvedRequest[] = [];
  if (config.perAgentBaseUrl) {
    if (routing === "header") {
      headers[config.agentHeaderName || DEFAULT_AGENT_HEADER] = agentId;
    }
    requests.push({
      url: buildPerAgentUrl(config.perAgentBaseUrl, scope, agentId, routing),
      init: {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      },
      mode: "per-agent",
    });
  }

  if (config.legacyBaseUrl) {
    requests.push({
      url: joinUrl(config.legacyBaseUrl, "api/v1/search/find"),
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      },
      mode: "legacy",
    });
  }

  return requests;
}

function layerFor(scope: OvSearchScope, mode: "per-agent" | "legacy"): OvStatsLayer {
  if (scope === "sessions") return "session-history";
  return mode === "legacy" ? "fast-pass-shared" : "fast-pass";
}

function uriFor(scope: OvSearchScope, agentId: string): string {
  return scope === "sessions" ? `viking://resources/${agentId}-sessions` : "viking://resources";
}

export async function executeLoggedOvRequest(opts: {
  request: ResolvedRequest;
  scope: OvSearchScope;
  agentId: string;
  query: string;
}): Promise<LoggedOvHttpResult> {
  const { request, scope, agentId, query } = opts;
  const startedAt = Date.now();

  try {
    const response = await fetch(request.url, request.init);
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      await writeOvStats({
        agent: agentId,
        op: scope === "sessions" ? "session-search" : "search",
        uri: uriFor(scope, agentId),
        query,
        latencyMs: Date.now() - startedAt,
        resultCount: 0,
        hit: false,
        mode: request.mode,
        layer: layerFor(scope, request.mode),
        routing: request.mode,
        status: response.status,
        failureClass: classifyOvFailure({ status: response.status, reason: text }),
        failure: text.slice(0, 200),
      }).catch(() => {});
      return { ok: false, status: response.status, text, mode: request.mode };
    }

    const data = await response.json();
    const result = data?.result ?? data;
    const items: any[] = [];
    for (const key of ["resources", "memories", "skills", "instructions"]) {
      if (Array.isArray(result?.[key])) items.push(...result[key]);
    }

    await writeOvStats({
      agent: agentId,
      op: scope === "sessions" ? "session-search" : "search",
      uri: uriFor(scope, agentId),
      query,
      latencyMs: Date.now() - startedAt,
      resultCount: items.length,
      hit: items.length > 0,
      mode: request.mode,
      layer: layerFor(scope, request.mode),
      routing: request.mode,
    }).catch(() => {});

    return { ok: true, status: response.status, data, mode: request.mode };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await writeOvStats({
      agent: agentId,
      op: scope === "sessions" ? "session-search" : "search",
      uri: uriFor(scope, agentId),
      query,
      latencyMs: Date.now() - startedAt,
      resultCount: 0,
      hit: false,
      mode: request.mode,
      layer: layerFor(scope, request.mode),
      routing: request.mode,
      failureClass: classifyOvFailure({ reason }),
      failure: reason.slice(0, 200),
    }).catch(() => {});
    return { ok: false, error: reason, mode: request.mode };
  }
}
