export type OvSearchScope = "memory" | "sessions";
export type OvAgentRouting = "header" | "query" | "path";

export type OvHttpConfig = {
  perAgentBaseUrl?: string;
  legacyBaseUrl?: string;
  agentRouting: OvAgentRouting;
  agentHeaderName: string;
  requestTimeoutMs: number;
};

export type ResolvedOvRequest = {
  url: string;
  init: RequestInit;
  mode: "per-agent" | "legacy";
};

export const DEFAULT_AGENT_HEADER = "x-openclaw-agent-id";

export function normalizeAgentId(raw: unknown): string {
  const value = String(raw ?? "").trim();
  if (!value) {
    return "main";
  }
  const normalized = value.replace(/[^a-zA-Z0-9._-]/g, "").replace(/^\.+/, "");
  return normalized && normalized !== "." && normalized !== ".." ? normalized : "main";
}

export function joinUrl(baseUrl: string, suffix: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${suffix.replace(/^\/+/, "")}`;
}

function endpointFor(scope: OvSearchScope): string {
  return scope === "sessions" ? "api/v1/search/session-find" : "api/v1/search/find";
}

function buildPerAgentUrl(params: {
  baseUrl: string;
  scope: OvSearchScope;
  agentId: string;
  routing: OvAgentRouting;
}): string {
  const endpoint = endpointFor(params.scope);
  if (params.routing === "query") {
    return `${joinUrl(params.baseUrl, endpoint)}?agentId=${encodeURIComponent(params.agentId)}`;
  }
  if (params.routing === "path") {
    return joinUrl(params.baseUrl, `agents/${encodeURIComponent(params.agentId)}/${endpoint}`);
  }
  return joinUrl(params.baseUrl, endpoint);
}

export function resolveOvRequests(params: {
  config: OvHttpConfig;
  scope: OvSearchScope;
  agentId: string;
  body: unknown;
  includeLegacy: boolean;
}): ResolvedOvRequest[] {
  const agentId = normalizeAgentId(params.agentId);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const requests: ResolvedOvRequest[] = [];

  if (params.config.perAgentBaseUrl) {
    if (params.config.agentRouting === "header") {
      headers[params.config.agentHeaderName] = agentId;
    }
    requests.push({
      url: buildPerAgentUrl({
        baseUrl: params.config.perAgentBaseUrl,
        scope: params.scope,
        agentId,
        routing: params.config.agentRouting,
      }),
      init: {
        method: "POST",
        headers,
        body: JSON.stringify(params.body),
        signal: AbortSignal.timeout(params.config.requestTimeoutMs),
      },
      mode: "per-agent",
    });
  }

  if (params.includeLegacy && params.config.legacyBaseUrl) {
    requests.push({
      url: joinUrl(params.config.legacyBaseUrl, endpointFor(params.scope)),
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params.body),
        signal: AbortSignal.timeout(params.config.requestTimeoutMs),
      },
      mode: "legacy",
    });
  }

  return requests;
}

export type OpenVikingItem = {
  uri?: unknown;
  score?: unknown;
  abstract?: unknown;
  overview?: unknown;
};

export type OpenVikingSearchPayload = {
  total?: unknown;
  resources?: unknown;
  memories?: unknown;
  skills?: unknown;
  instructions?: unknown;
};

export function normalizeOpenVikingPayload(raw: unknown): {
  total: number;
  items: OpenVikingItem[];
} {
  const result =
    raw && typeof raw === "object" && "result" in raw ? (raw as { result?: unknown }).result : raw;
  const payload =
    result && typeof result === "object" ? (result as OpenVikingSearchPayload) : undefined;
  const items: OpenVikingItem[] = [];
  for (const key of ["resources", "memories", "skills", "instructions"] as const) {
    const value = payload?.[key];
    if (Array.isArray(value)) {
      items.push(...(value as OpenVikingItem[]));
    }
  }
  const total = typeof payload?.total === "number" ? payload.total : items.length;
  return { total, items };
}
