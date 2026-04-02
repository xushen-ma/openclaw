#!/usr/bin/env node
import http from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  DEFAULT_MEMORY_ROOT,
  resolveAgentAndScope,
  resolveStorePath,
  toOpenVikingResult,
} from "./per-agent-ov-http-common.mjs";

const execFileAsync = promisify(execFile);

const PORT = Number(process.env.OV_PER_AGENT_HTTP_PORT || 8091);
const HOST = process.env.OV_PER_AGENT_HTTP_HOST || "127.0.0.1";
const MEMORY_ROOT = process.env.OV_PER_AGENT_MEMORY_ROOT || DEFAULT_MEMORY_ROOT;
const PYTHON_BIN =
  process.env.OV_PYTHON_BIN ||
  "/Users/openclaw/.openclaw/workspace/projects/openviking-migration/tmp/openviking-venv/bin/python";
const TIMEOUT_MS = Number(process.env.OV_PER_AGENT_TIMEOUT_MS || 15_000);
const MOCK_MODE = process.env.OV_PER_AGENT_HTTP_MOCK === "1";

function writeJson(res, statusCode, body) {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function searchStore({ storePath, query, limit }) {
  if (MOCK_MODE) {
    return {
      total: 1,
      items: [
        {
          uri: `viking://resources/${storePath.split("/").slice(-1)[0]}/mock`,
          score: 0.91,
          abstract: `mock result for: ${query}`,
        },
      ],
    };
  }

  const script = `
import json, sys
import openviking

store, query, limit = sys.argv[1], sys.argv[2], int(sys.argv[3])
client = None
try:
    client = openviking.SyncOpenViking(path=store)
    client.initialize()
    res = client.search(query=query, target_uri=\"viking://resources\", limit=limit)
    items = []
    for key in (\"resources\", \"memories\", \"skills\", \"instructions\"):
        values = getattr(res, key, None) or []
        for item in values:
            items.append({
                \"uri\": getattr(item, \"uri\", \"\"),
                \"score\": float(getattr(item, \"score\", 0.0)),
                \"abstract\": getattr(item, \"abstract\", \"\"),
            })
    print(json.dumps({\"total\": int(getattr(res, \"total\", len(items))), \"items\": items[:limit]}))
except Exception as e:
    print(json.dumps({\"error\": str(e)}))
finally:
    if client:
        try:
            client.close()
        except Exception:
            pass
`;

  const { stdout } = await execFileAsync(PYTHON_BIN, ["-c", script, storePath, query, String(limit)], {
    timeout: TIMEOUT_MS,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
  });

  const parsed = JSON.parse(String(stdout || "{}").trim() || "{}");
  if (parsed.error) throw new Error(parsed.error);
  return parsed;
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : {};
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/healthz") {
    return writeJson(res, 200, { ok: true, mock: MOCK_MODE, memoryRoot: MEMORY_ROOT });
  }
  if (req.method !== "POST" || !req.url) {
    return writeJson(res, 404, { error: "not found" });
  }

  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const { scope, agentId } = resolveAgentAndScope({
      pathname: url.pathname,
      query: url.searchParams,
      headers: req.headers,
    });

    if (!scope) {
      return writeJson(res, 404, { error: "unsupported endpoint" });
    }

    const body = await readJsonBody(req);
    const query = String(body?.query || "").trim();
    const limit = Math.max(1, Math.min(Number(body?.limit || 5), 25));
    if (!query) return writeJson(res, 400, { error: "query is required" });

    const storePath = resolveStorePath({ memoryRoot: MEMORY_ROOT, agentId, scope });
    const searchResult = await searchStore({ storePath, query, limit });
    const response = {
      ...toOpenVikingResult(searchResult, limit),
      meta: { agentId, scope, storePath },
    };
    return writeJson(res, 200, response);
  } catch (error) {
    return writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`[ov-per-agent-http] listening on http://${HOST}:${PORT} (mock=${MOCK_MODE ? "on" : "off"})`);
});
