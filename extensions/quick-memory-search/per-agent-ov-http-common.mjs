import path from "node:path";

export const DEFAULT_AGENT_HEADER = "x-openclaw-agent-id";
export const DEFAULT_MEMORY_ROOT = "/Users/openclaw/.openclaw/memory/openviking";

export function normalizeAgentId(raw) {
  const value = String(raw || "").trim();
  if (!value) return "main";

  // keep this surgical: only permit simple ids used by OpenClaw agent names
  let normalized = value.replace(/[^a-zA-Z0-9._-]/g, "");
  // prevent path traversal-ish identities like ".", "..", "...", etc.
  normalized = normalized.replace(/^\.+/, "");
  if (!normalized || normalized === "." || normalized === "..") return "main";
  return normalized;
}

export function resolveRequestScope(urlPathname) {
  if (urlPathname.endsWith("/api/v1/search/session-find")) return "sessions";
  if (urlPathname.endsWith("/api/v1/search/find")) return "memory";
  return null;
}

export function resolveAgentAndScope({ pathname, query, headers }) {
  const scope = resolveRequestScope(pathname);
  if (!scope) return { scope: null, agentId: "main" };

  // path form: /agents/<agent>/api/v1/search/find
  const pathMatch = pathname.match(/^\/agents\/([^/]+)\/(api\/v1\/search\/(?:find|session-find))$/);
  if (pathMatch) {
    const pathScope = resolveRequestScope(`/${pathMatch[2]}`);
    return { scope: pathScope, agentId: normalizeAgentId(decodeURIComponent(pathMatch[1])) };
  }

  const fromQuery = query.get("agentId");
  const fromHeader = headers[DEFAULT_AGENT_HEADER] || headers[DEFAULT_AGENT_HEADER.toLowerCase()];
  return {
    scope,
    agentId: normalizeAgentId(fromQuery || fromHeader || "main"),
  };
}

export function resolveStorePath({ memoryRoot = DEFAULT_MEMORY_ROOT, agentId, scope }) {
  const base = scope === "sessions" ? `${agentId}-sessions` : agentId;
  return path.join(memoryRoot, base);
}

export function toOpenVikingResult(searchResult, limit) {
  const resources = [];
  const items = searchResult?.items || [];
  for (const item of items.slice(0, limit)) {
    resources.push({
      uri: item.uri || "",
      score: Number(item.score || 0),
      abstract: item.abstract || "",
    });
  }
  return {
    result: {
      total: Number(searchResult?.total || resources.length),
      resources,
      memories: [],
      skills: [],
      instructions: [],
    },
  };
}
