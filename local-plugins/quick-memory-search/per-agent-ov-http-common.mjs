import path from "node:path";

export const DEFAULT_AGENT_HEADER = "x-openclaw-agent-id";
export const DEFAULT_MEMORY_ROOT = path.join(
  process.env.HOME || "/tmp",
  ".openclaw",
  "memory",
  "openviking",
);

export function normalizeAgentId(raw) {
  const value = String(raw || "").trim();
  if (!value) {
    return "main";
  }
  const normalized = value.replace(/[^a-zA-Z0-9._-]/g, "").replace(/^\.+/, "");
  return normalized && normalized !== "." && normalized !== ".." ? normalized : "main";
}

export function resolveRequestScope(urlPathname) {
  if (urlPathname.endsWith("/api/v1/search/session-find")) {
    return "sessions";
  }
  if (urlPathname.endsWith("/api/v1/search/find")) {
    return "memory";
  }
  return null;
}

export function resolveAgentAndScope({ pathname, query, headers }) {
  const pathMatch = pathname.match(/^\/agents\/([^/]+)\/(api\/v1\/search\/(?:find|session-find))$/);
  if (pathMatch) {
    return {
      scope: resolveRequestScope(`/${pathMatch[2]}`),
      agentId: normalizeAgentId(decodeURIComponent(pathMatch[1])),
    };
  }
  const scope = resolveRequestScope(pathname);
  if (!scope) {
    return { scope: null, agentId: "main" };
  }
  const fromQuery = query.get("agentId");
  const fromHeader = headers[DEFAULT_AGENT_HEADER] || headers[DEFAULT_AGENT_HEADER.toLowerCase()];
  return { scope, agentId: normalizeAgentId(fromQuery || fromHeader || "main") };
}

export function resolveStorePath({ memoryRoot = DEFAULT_MEMORY_ROOT, agentId, scope }) {
  const base = scope === "sessions" ? `${normalizeAgentId(agentId)}-sessions` : normalizeAgentId(agentId);
  return path.join(memoryRoot, base);
}

export function toOpenVikingResult(searchResult, limit) {
  const resources = [];
  for (const item of (searchResult?.items || []).slice(0, limit)) {
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
