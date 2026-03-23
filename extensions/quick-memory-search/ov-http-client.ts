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
