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
  timeoutMs: number;
};

const DEFAULT_AGENT_HEADER = "x-openclaw-agent-id";
const DEFAULT_OV_HTTP_TIMEOUT_MS = 10_000;
const MAX_EMBEDDING_INPUT_CHARS = 8_192;

type OvResultItem = {
  uri?: unknown;
  score?: unknown;
  abstract?: unknown;
  overview?: unknown;
  text?: unknown;
  content?: unknown;
};

export type NormalizedOvResult = {
  totalHits: number;
  items: OvResultItem[];
};

function isAbortLikeError(err: unknown): boolean {
  if (!(err instanceof Error)) {
    return false;
  }
  return (
    err.name === "AbortError" ||
    err.name === "TimeoutError" ||
    /aborted|abort|timeout|timed out/i.test(err.message)
  );
}

function resolveTimeoutMs(): number {
  const raw = Number(process.env.OV_HTTP_TIMEOUT_MS || "");
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_OV_HTTP_TIMEOUT_MS;
}

export function truncateEmbeddingInput(text: string): { text: string; truncated: boolean } {
  const trimmed = text.trim();
  if (trimmed.length <= MAX_EMBEDDING_INPUT_CHARS) {
    return { text: trimmed, truncated: false };
  }
  const marker = "[truncated for OV embedding input limit]\n";
  return {
    text: `${marker}${trimmed.slice(-(MAX_EMBEDDING_INPUT_CHARS - marker.length)).trimStart()}`,
    truncated: true,
  };
}

function collectItems(result: unknown): OvResultItem[] {
  if (Array.isArray(result)) {
    return result as OvResultItem[];
  }
  if (typeof result !== "object" || result === null) {
    return [];
  }

  const record = result as Record<string, unknown>;
  const items: OvResultItem[] = [];
  for (const key of ["resources", "memories", "skills", "instructions", "items", "results"]) {
    if (Array.isArray(record[key])) {
      items.push(...(record[key] as OvResultItem[]));
    }
  }
  return items;
}

export function normalizeOvSearchResult(data: unknown): NormalizedOvResult {
  const envelope =
    typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {};
  const result = envelope.result ?? envelope.data ?? data;
  const resultRecord =
    typeof result === "object" && result !== null ? (result as Record<string, unknown>) : {};
  const envelopeItems = collectItems(envelope);
  const resultItems = collectItems(result);
  const items = resultItems.length > 0 ? resultItems : envelopeItems;

  const total =
    resultRecord.total ??
    resultRecord.totalHits ??
    resultRecord.total_hits ??
    envelope.total ??
    envelope.totalHits ??
    envelope.total_hits;

  return {
    totalHits: typeof total === "number" && Number.isFinite(total) ? total : items.length,
    items,
  };
}

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
  const timeoutMs = resolveTimeoutMs();

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
      },
      mode: "per-agent",
      timeoutMs,
    });
  }

  if (config.legacyBaseUrl) {
    requests.push({
      url: joinUrl(config.legacyBaseUrl, "api/v1/search/find"),
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      mode: "legacy",
      timeoutMs,
    });
  }

  return requests;
}

export async function fetchOvRequest(
  attempt: ResolvedRequest,
  fetchFn: typeof fetch = fetch,
): Promise<Response> {
  const maxAttempts = attempt.mode === "per-agent" ? 2 : 1;
  let lastError: unknown;
  for (let index = 0; index < maxAttempts; index += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), attempt.timeoutMs);
    try {
      return await fetchFn(attempt.url, { ...attempt.init, signal: controller.signal });
    } catch (err) {
      lastError = err;
      if (!isAbortLikeError(err) || index + 1 >= maxAttempts) {
        throw err;
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
