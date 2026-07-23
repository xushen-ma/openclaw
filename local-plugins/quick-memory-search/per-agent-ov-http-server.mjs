#!/usr/bin/env node
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  resolveAgentAndScope,
  resolveStorePath,
  toOpenVikingResult,
  DEFAULT_MEMORY_ROOT,
} from "./per-agent-ov-http-common.mjs";

const execFileAsync = promisify(execFile);
const host = process.env.OV_PER_AGENT_HTTP_HOST || "127.0.0.1";
const port = Number(process.env.OV_PER_AGENT_HTTP_PORT || 8091);
const memoryRoot = process.env.OV_PER_AGENT_MEMORY_ROOT || DEFAULT_MEMORY_ROOT;
const pythonBin = process.env.OV_PYTHON_BIN;
const timeoutMs = Number(process.env.OV_PER_AGENT_TIMEOUT_MS || 15000);
const mock = process.env.OV_PER_AGENT_HTTP_MOCK === "1";

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : {};
}

async function searchStore({ storePath, query, limit }) {
  if (mock) {
    return { total: 1, items: [{ uri: `mock://${storePath}`, score: 1, abstract: query }] };
  }
  if (!pythonBin) {
    return { total: 0, items: [], error: "OV_PYTHON_BIN is required when mock mode is off" };
  }
  const script = `
import sys, json
import openviking
store, query, limit = sys.argv[1], sys.argv[2], int(sys.argv[3])
client = openviking.SyncOpenViking(path=store)
client.initialize()
result = client.search(query=query, target_uri="viking://resources", limit=limit)
items = []
for key in ("resources", "memories", "skills"):
    items.extend(getattr(result, key, []) or [])
print(json.dumps({
  "total": getattr(result, "total", len(items)),
  "items": [
    {"uri": getattr(item, "uri", str(item)), "score": float(getattr(item, "score", 0)), "abstract": getattr(item, "abstract", "")}
    for item in items[:limit]
  ],
}))
client.close()
`;
  try {
    const { stdout } = await execFileAsync(pythonBin, ["-c", script, storePath, query, String(limit)], {
      timeout: timeoutMs,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    });
    return JSON.parse(stdout.trim());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { total: 0, items: [], error: message.slice(0, 200) };
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${host}:${port}`);
    if (req.method === "GET" && url.pathname === "/healthz") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, memoryRoot, mock }));
      return;
    }
    if (req.method !== "POST") {
      res.writeHead(405);
      res.end("method not allowed");
      return;
    }
    const { scope, agentId } = resolveAgentAndScope({
      pathname: url.pathname,
      query: url.searchParams,
      headers: req.headers,
    });
    if (!scope) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    const body = await readJson(req);
    const query = typeof body.query === "string" ? body.query.trim() : "";
    const limit = typeof body.limit === "number" && body.limit > 0 ? Math.floor(body.limit) : 5;
    const storePath = resolveStorePath({ memoryRoot, agentId, scope });
    const result = await searchStore({ storePath, query, limit });
    const payload = {
      ...toOpenVikingResult(result, limit),
      meta: { agentId, scope, storePath },
      ...(result.error ? { error: result.error } : {}),
    };
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(payload));
  } catch (err) {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
  }
});

server.listen(port, host, () => {
  console.log(`quick-memory per-agent OV HTTP listening on http://${host}:${port}`);
});
