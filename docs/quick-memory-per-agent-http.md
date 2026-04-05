# Quick Memory Search: per-agent HTTP-backed OpenViking

## What changed

Implemented a minimal server-side per-agent OV HTTP backend in this repo, matching the extension's routing contract for:

- `quick_memory_search`
- `quick_session_search`

### New server-side files

- `extensions/quick-memory-search/per-agent-ov-http-server.mjs`
- `extensions/quick-memory-search/per-agent-ov-http-common.mjs`
- `extensions/quick-memory-search/per-agent-ov-http-common.test.mjs`

### Existing extension files already aligned to this backend

- `extensions/quick-memory-search/index.ts`
- `extensions/quick-memory-search/session-search.ts`
- `extensions/quick-memory-search/ov-http-client.ts`
- `extensions/quick-memory-search/openclaw.plugin.json`

## Routing contract supported

Server accepts all three forms already supported by the client extension:

1. **Header routing (default)**
   - Endpoint: `POST /api/v1/search/find` or `POST /api/v1/search/session-find`
   - Header: `x-openclaw-agent-id: <agent>`

2. **Query routing**
   - `POST /api/v1/search/find?agentId=<agent>`
   - `POST /api/v1/search/session-find?agentId=<agent>`

3. **Path routing**
   - `POST /agents/<agent>/api/v1/search/find`
   - `POST /agents/<agent>/api/v1/search/session-find`

## Store mapping

- Memory search store: `~/.openclaw/memory/openviking/<agent>`
- Session search store: `~/.openclaw/memory/openviking/<agent>-sessions`

(Override root with `OV_PER_AGENT_MEMORY_ROOT` if needed.)

## Server runtime

Run locally:

```bash
node extensions/quick-memory-search/per-agent-ov-http-server.mjs
```

Env knobs:

- `OV_PER_AGENT_HTTP_HOST` (default `127.0.0.1`)
- `OV_PER_AGENT_HTTP_PORT` (default `8091`)
- `OV_PER_AGENT_MEMORY_ROOT` (default `~/.openclaw/memory/openviking`)
- `OV_PYTHON_BIN` (OpenViking venv python)
- `OV_PER_AGENT_TIMEOUT_MS` (default `15000`)
- `OV_PER_AGENT_HTTP_MOCK=1` (mock mode for dry validation)

Health:

- `GET /healthz`

## Verification

### Dev-level verification (done)

1. Unit-style helper tests:

```bash
node extensions/quick-memory-search/per-agent-ov-http-common.test.mjs
```

2. End-to-end local server checks:

- Header route memory search:

```bash
curl -X POST http://127.0.0.1:8091/api/v1/search/find \
  -H 'content-type: application/json' \
  -H 'x-openclaw-agent-id: ben' \
  -d '{"query":"test","limit":2}'
```

- Query route session search:

```bash
curl -X POST 'http://127.0.0.1:8091/api/v1/search/session-find?agentId=ben' \
  -H 'content-type: application/json' \
  -d '{"query":"gateway","limit":1}'
```

- Path route memory search:

```bash
curl -X POST 'http://127.0.0.1:8091/agents/ben/api/v1/search/find' \
  -H 'content-type: application/json' \
  -d '{"query":"memory","limit":1}'
```

Observed: all three returned OpenViking-shaped JSON with `meta.agentId`, `meta.scope`, and correct per-agent store path.

### Staging-style verification (ready + reproducible)

In staging config/plugin settings, set:

- `perAgentOvBaseUrl: "http://127.0.0.1:8091"`
- `agentRouting: "header"` (or query/path)
- optional `ovBaseUrl` only for transitional fallback

Then:

1. Start this per-agent HTTP backend on staging host.
2. Invoke `quick_memory_search` and `quick_session_search` from at least two agents.
3. Confirm response `routing: "per-agent"` (quick_memory_search) and session results via per-agent scope.

## Notes

- This implementation is intentionally minimal: a thin HTTP -> OpenViking search proxy with strict scope mapping.
- `quick_memory_search` remains the first-choice cheap/fast recall path; no policy changes.
- Legacy shared OV HTTP remains optional fallback only.
