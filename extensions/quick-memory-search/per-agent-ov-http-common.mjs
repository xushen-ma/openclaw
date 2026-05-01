import path from "node:path";

export const DEFAULT_AGENT_HEADER = "x-openclaw-agent-id";
export const DEFAULT_MEMORY_ROOT = "/Users/openclaw/.openclaw/memory/openviking";
export const MAX_EMBEDDING_INPUT_CHARS = 8192;

export function truncateEmbeddingInput(raw) {
  const text = String(raw || "").trim();
  if (text.length <= MAX_EMBEDDING_INPUT_CHARS) {
    return { text, truncated: false };
  }
  const marker = "[truncated for OV embedding input limit]\n";
  return {
    text: `${marker}${text.slice(-(MAX_EMBEDDING_INPUT_CHARS - marker.length)).trimStart()}`,
    truncated: true,
  };
}

export function normalizeAgentId(raw) {
  const value = String(raw || "").trim();
  if (!value) {
    return "main";
  }

  // keep this surgical: only permit simple ids used by OpenClaw agent names
  let normalized = value.replace(/[^a-zA-Z0-9._-]/g, "");
  // prevent path traversal-ish identities like ".", "..", "...", etc.
  normalized = normalized.replace(/^\.+/, "");
  if (!normalized || normalized === "." || normalized === "..") {
    return "main";
  }
  return normalized;
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
  const scope = resolveRequestScope(pathname);
  if (!scope) {
    return { scope: null, agentId: "main" };
  }

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
  const items = searchResult?.items || searchResult?.results || [];
  for (const item of items.slice(0, limit)) {
    resources.push({
      uri: item.uri || "",
      score: Number(item.score || 0),
      abstract: item.abstract || item.overview || item.text || item.content || "",
    });
  }
  return {
    result: {
      total: Number(searchResult?.total || searchResult?.totalHits || searchResult?.total_hits || resources.length),
      resources,
      memories: [],
      skills: [],
      instructions: [],
    },
  };
}

export function createOpenVikingSearchScript() {
  return `
import json, sys, time
import openviking

store, query, limit = sys.argv[1], sys.argv[2], int(sys.argv[3])
MAX_RETRIES = 1
BACKOFF = [0.5]

def item_value(item, name, default=""):
    if isinstance(item, dict):
        return item.get(name, default)
    return getattr(item, name, default)

for attempt in range(MAX_RETRIES + 1):
    client = None
    try:
        client = openviking.SyncOpenViking(path=store)
        client.initialize()
        res = client.search(query=query, target_uri="viking://resources", limit=limit)
        total = getattr(res, "total", None)
        items = []
        for key in ("resources", "memories", "skills", "instructions", "items", "results"):
            values = getattr(res, key, None)
            if values is None and isinstance(res, dict):
                values = res.get(key)
            items.extend(values or [])
        print(json.dumps({
            "total": int(total if total is not None else len(items)),
            "items": [{
                "uri": item_value(i, "uri", str(i)),
                "score": float(item_value(i, "score", 0) or 0),
                "abstract": item_value(i, "abstract", "") or item_value(i, "overview", "") or item_value(i, "text", "") or item_value(i, "content", ""),
            } for i in items[:limit]]
        }))
        break
    except Exception as e:
        if ("lock" in str(e).lower() or "timeout" in str(e).lower()) and attempt < MAX_RETRIES:
            time.sleep(BACKOFF[attempt])
            continue
        print(json.dumps({"error": str(e)[:500]}))
        break
    finally:
        try:
            if client is not None:
                client.close()
        except Exception:
            pass
`;
}
