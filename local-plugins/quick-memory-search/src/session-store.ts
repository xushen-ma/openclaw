import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { normalizeAgentId } from "./ov-http.js";

const execFileAsync = promisify(execFile);

export type SessionFallbackConfig = {
  enabled: boolean;
  memoryRoot?: string;
  pythonBin?: string;
  timeoutMs: number;
};

export type LocalSessionSearchResult = {
  total: number;
  items: Array<{ uri?: unknown; score?: unknown; abstract?: unknown }>;
  error?: string;
};

export type RunOpenVikingSessionSearch = (params: {
  storePath: string;
  query: string;
  limit: number;
  pythonBin: string;
  timeoutMs: number;
}) => Promise<LocalSessionSearchResult>;

export function resolveSessionStorePath(params: { memoryRoot: string; agentId: string }): string {
  return `${params.memoryRoot.replace(/\/+$/, "")}/${normalizeAgentId(params.agentId)}-sessions`;
}

export const OPENVIKING_SESSION_SEARCH_SCRIPT = `
import sys, json, time
import openviking

store, query, limit = sys.argv[1], sys.argv[2], int(sys.argv[3])
backoff = [0.5, 1.0, 2.0]

for attempt in range(len(backoff) + 1):
    client = None
    try:
        client = openviking.SyncOpenViking(path=store)
        client.initialize()
        result = client.search(query=query, target_uri="viking://resources", limit=limit)
        items = []
        for key in ("resources", "memories", "skills"):
            items.extend(getattr(result, key, []) or [])
        print(json.dumps({
            "total": getattr(result, "total", len(items)),
            "items": [
                {
                    "uri": getattr(item, "uri", str(item)),
                    "score": float(getattr(item, "score", 0)),
                    "abstract": getattr(item, "abstract", ""),
                }
                for item in items[:limit]
            ],
        }))
        break
    except Exception as exc:
        if client is not None:
            try:
                client.close()
            except Exception:
                pass
        if "lock" in str(exc).lower() and attempt < len(backoff):
            time.sleep(backoff[attempt])
            continue
        print(json.dumps({"total": 0, "items": [], "error": str(exc)[:200]}))
        break
    finally:
        if client is not None:
            try:
                client.close()
            except Exception:
                pass
`;

export async function runOpenVikingSessionSearch({
  storePath,
  query,
  limit,
  pythonBin,
  timeoutMs,
}: Parameters<RunOpenVikingSessionSearch>[0]): Promise<LocalSessionSearchResult> {
  try {
    const { stdout } = await execFileAsync(
      pythonBin,
      ["-c", OPENVIKING_SESSION_SEARCH_SCRIPT, storePath, query, String(limit)],
      {
        timeout: timeoutMs,
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
      },
    );
    return JSON.parse(stdout.trim()) as LocalSessionSearchResult;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { total: 0, items: [], error: message.slice(0, 200) };
  }
}
